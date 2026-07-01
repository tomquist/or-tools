// Copyright 2010-2025 Google LLC
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

#include "ortools/sat/node/src/cpp/solve_wrapper.h"

#include <atomic>
#include <condition_variable>
#include <cstdint>
#include <memory>
#include <mutex>
#include <string>
#include <utility>
#include <vector>

#include <napi.h>

#include "ortools/sat/cp_model.pb.h"
#include "ortools/sat/sat_parameters.pb.h"
#include "ortools/sat/swig_helper.h"

namespace operations_research::sat::node_binding {

// ----------------------------------------------------------------------------
// Callback-dispatch tracker
// ----------------------------------------------------------------------------
//
// Counts async callback payloads (solution + best-bound) that have been
// enqueued to the JS thread but not yet dispatched. The solve worker thread
// waits on this (via WaitForCallbackDispatchDrain) so that Solve()'s promise
// resolves only after every solution and best-bound update has been delivered
// to the user's callback -- matching the synchronous "all callbacks fire before
// solve() returns" contract of the Python/Java/C#/Go bindings, without making
// the JS solve() itself blocking. (Log lines stay best-effort NonBlockingCall;
// they are not asserted on and may drop under load, as in other bindings.)
struct CallbackDispatchTracker {
  std::mutex mu;
  std::condition_variable cv;
  int pending = 0;

  // Called on a SAT worker thread just before a payload is enqueued.
  void Begin() {
    std::lock_guard<std::mutex> lock(mu);
    ++pending;
  }
  // Called on the JS thread once a payload has been fully dispatched (on every
  // return path of the dispatcher, so a skipped payload still counts down).
  void End() {
    {
      std::lock_guard<std::mutex> lock(mu);
      --pending;
    }
    cv.notify_all();
  }
  // Called on the solve worker thread; returns once all enqueued payloads have
  // been dispatched. Safe when pending is already zero (no callbacks).
  void Wait() {
    std::unique_lock<std::mutex> lock(mu);
    cv.wait(lock, [this] { return pending == 0; });
  }
};

// ----------------------------------------------------------------------------
// Solution callback bridge
// ----------------------------------------------------------------------------
//
// The native sat::SolutionCallback's OnSolutionCallback is invoked by a SAT
// worker thread. We must not touch v8 from there. The bridge:
//   * snapshots SharedResponse() (a shared_ptr<CpSolverResponse>),
//   * dispatches to the JS thread via a TSFN with BlockingCall,
//   * the JS-side dispatcher constructs a frozen "context" object and invokes
//     onSolutionCallback(ctx) on the user's target.
//
// Lifetime: the bridge is owned by its own ThreadSafeFunction. Construction
// returns a raw pointer that the SolveWrapperJs holds non-owningly. To
// release, call Detach(); that releases the TSFN, which will drain any
// queued payloads on the JS thread and then run the TSFN finalizer that
// `delete`s the bridge. This is required because every queued Payload holds
// pointers into the bridge's Napi references -- destroying the bridge while
// payloads remain in flight (e.g. eagerly when solve() resolves) would
// dangle those pointers and segfault when the TSFN queue is drained later
// (most commonly at process teardown, since the TSFN is Unref'd).

class SolveWrapperJs::SolutionBridge : public sat::SolutionCallback {
 public:
  // Factory: creates a bridge whose lifetime is owned by its TSFN. The
  // returned pointer is valid until Detach() is called *and* the TSFN queue
  // has been fully drained on the JS thread. Callers must only hold it
  // non-owningly.
  static SolutionBridge* Create(
      Napi::Env env, Napi::Object target_obj, Napi::Function on_solution_fn,
      std::shared_ptr<CallbackDispatchTracker> tracker) {
    auto* bridge = new SolutionBridge();
    bridge->tracker_ = std::move(tracker);
    bridge->target_ref_ = Napi::Persistent(target_obj);
    bridge->on_solution_ref_ = Napi::Persistent(on_solution_fn);
    bridge->tsfn_ = Napi::ThreadSafeFunction::New(
        env, on_solution_fn, "ortools-solution-cb",
        /*max_queue_size=*/0, /*initial_thread_count=*/1,
        /*finalizer=*/[](Napi::Env, SolutionBridge* self) { delete self; },
        /*data=*/bridge);
    bridge->tsfn_.Unref(env);
    return bridge;
  }

  // Releases the TSFN. Once any in-flight payloads have been drained on the
  // JS thread, the TSFN finalizer runs and `delete`s this bridge. Idempotent
  // and safe to call multiple times; only the first call has effect.
  void Detach() {
    if (detached_.exchange(true)) return;
    tsfn_.Release();
  }

  // Called from a SAT worker thread.
  void OnSolutionCallback() const override {
    if (detached_.load()) return;

    auto resp = SharedResponse();
    if (!resp) return;

    // Capture the wrapper pointer so the JS dispatcher can call back into
    // SolveWrapper::StopSearch() if the user's callback requests it.
    sat::SolveWrapper* w = wrapper();

    // Count this payload as in-flight before enqueuing so the solve worker can
    // wait for it to drain. The matching End() runs in DispatchOnJsThread.
    if (tracker_) tracker_->Begin();
    auto* payload =
        new Payload{resp, w, this, &target_ref_, &on_solution_ref_, tracker_};
    auto status =
        tsfn_.BlockingCall(payload, &SolutionBridge::DispatchOnJsThread);
    if (status != napi_ok) {
      // TSFN closed (e.g. Detach() raced with a worker callback). Drop the
      // payload; nothing was queued so the dispatcher will not run -- so
      // balance the Begin() here.
      delete payload;
      if (tracker_) tracker_->End();
    }
  }

 private:
  // Constructible only via Create(); destructible only via the TSFN
  // finalizer. This enforces the lifetime contract above.
  SolutionBridge() = default;
  ~SolutionBridge() override = default;

  struct Payload {
    std::shared_ptr<sat::CpSolverResponse> response;
    sat::SolveWrapper* wrapper;
    // Back-pointer to the bridge so the dispatcher can short-circuit late
    // callbacks (queued on the worker thread before Detach() ran) and avoid
    // touching the user-facing target after the JS-side solve has resolved.
    const SolutionBridge* bridge;
    const Napi::Reference<Napi::Object>* target_ref;
    const Napi::Reference<Napi::Function>* fn_ref;
    std::shared_ptr<CallbackDispatchTracker> tracker;
  };

  static void DispatchOnJsThread(Napi::Env env, Napi::Function /*noop*/,
                                 Payload* payload) {
    std::unique_ptr<Payload> p(payload);
    // Decrement the in-flight counter on every return path (including the
    // env==nullptr teardown path and the detached short-circuit below) so that
    // WaitForCallbackDispatchDrain() can never hang.
    struct DrainGuard {
      std::shared_ptr<CallbackDispatchTracker> t;
      ~DrainGuard() {
        if (t) t->End();
      }
    } drain_guard{p ? p->tracker : nullptr};

    if (env == nullptr || !p) return;
    // Defensive: skip if the bridge was already detached. In the normal flow
    // this never triggers -- the solve worker drains all queued payloads (see
    // WaitForCallbackDispatchDrain) *before* OnOK detaches the bridge, so every
    // solution is delivered before solve() resolves. This guard only covers
    // teardown-time edge cases (e.g. a stray payload during process exit),
    // where invoking the user's callback would be unsafe or surprising.
    if (p->bridge != nullptr && p->bridge->detached_.load()) return;

    Napi::HandleScope scope(env);

    // Build a frozen "SolutionContext" object. The JS side reads from this
    // synchronously; once onSolutionCallback returns, we drop the snapshot.
    Napi::Object ctx = Napi::Object::New(env);

    // Stash the response shared_ptr inside the ctx so closures can reach it.
    auto* shared_resp =
        new std::shared_ptr<sat::CpSolverResponse>(p->response);
    ctx.AddFinalizer(
        [](Napi::Env, std::shared_ptr<sat::CpSolverResponse>* r) { delete r; },
        shared_resp);

    // value(varIndex) -> bigint
    ctx.Set(
        "value",
        Napi::Function::New(env, [shared_resp](const Napi::CallbackInfo& info) {
          int idx = info[0].As<Napi::Number>().Int32Value();
          int64_t v = idx >= 0 ? (*shared_resp)->solution(idx)
                               : -(*shared_resp)->solution(-idx - 1);
          return Napi::BigInt::New(info.Env(), v);
        }));

    // booleanValue(varIndex) -> boolean
    ctx.Set("booleanValue",
            Napi::Function::New(
                env, [shared_resp](const Napi::CallbackInfo& info) {
                  int idx = info[0].As<Napi::Number>().Int32Value();
                  bool b = idx >= 0
                               ? (*shared_resp)->solution(idx) != 0
                               : (*shared_resp)->solution(-idx - 1) == 0;
                  return Napi::Boolean::New(info.Env(), b);
                }));

    auto add_double = [&](const char* name, double v) {
      ctx.Set(name, Napi::Number::New(env, v));
    };
    auto add_long = [&](const char* name, int64_t v) {
      // Counters are int64; surface as JS number when they fit, otherwise
      // BigInt. Counters always fit on 2^53 in practice for CP-SAT.
      ctx.Set(name, Napi::Number::New(env, static_cast<double>(v)));
    };

    const auto& r = *p->response;
    add_double("objectiveValue", r.objective_value());
    add_double("bestObjectiveBound", r.best_objective_bound());
    add_long("numBooleans", r.num_booleans());
    add_long("numConflicts", r.num_conflicts());
    add_long("numBranches", r.num_branches());
    add_long("numIntegerPropagations", r.num_integer_propagations());
    add_long("numBinaryPropagations", r.num_binary_propagations());
    add_double("wallTime", r.wall_time());
    add_double("userTime", r.user_time());
    add_double("deterministicTime", r.deterministic_time());

    // responseBytes for callers who want the full proto.
    std::string bytes;
    r.SerializeToString(&bytes);
    ctx.Set("responseBytes",
            Napi::Buffer<uint8_t>::Copy(
                env, reinterpret_cast<const uint8_t*>(bytes.data()),
                bytes.size()));

    // stopSearch() -> void
    sat::SolveWrapper* w = p->wrapper;
    ctx.Set("stopSearch", Napi::Function::New(
                              env, [w](const Napi::CallbackInfo&) {
                                if (w != nullptr) w->StopSearch();
                              }));

    if (env.Global().Get("Object").As<Napi::Object>().Has("freeze")) {
      env.Global()
          .Get("Object")
          .As<Napi::Object>()
          .Get("freeze")
          .As<Napi::Function>()
          .Call({ctx});
    }

    try {
      p->fn_ref->Value().Call(p->target_ref->Value(), {ctx});
    } catch (const Napi::Error& err) {
      // Honor the C++/exception propagation contract: surface the error to
      // the solver thread by stopping the search. The promise from solve()
      // will resolve with whatever response we have; the user's onResponse
      // observer can detect failure via solver.status. We don't have a way
      // to "fail" the promise from inside a TSFN dispatch; logging is the
      // safest fallback.
      Napi::Function console_error =
          env.Global()
              .Get("console")
              .As<Napi::Object>()
              .Get("error")
              .As<Napi::Function>();
      console_error.Call({Napi::String::New(env,
                                            "[ortools] solution callback "
                                            "threw; stopping search: "),
                          err.Value()});
      if (w != nullptr) w->StopSearch();
    }
  }

  Napi::ThreadSafeFunction tsfn_;
  Napi::Reference<Napi::Object> target_ref_;
  Napi::Reference<Napi::Function> on_solution_ref_;
  // Shared with the owning SolveWrapperJs; tracks in-flight dispatches.
  std::shared_ptr<CallbackDispatchTracker> tracker_;
  // Set when Detach() runs; suppresses further BlockingCalls (which would
  // race with the TSFN being released) without changing the visible "alive"
  // state on the JS side.
  std::atomic<bool> detached_{false};
};

// ----------------------------------------------------------------------------
// Async worker for solve()
// ----------------------------------------------------------------------------

namespace {

class SolveAsyncWorker : public Napi::AsyncWorker {
 public:
  SolveAsyncWorker(Napi::Env env, SolveWrapperJs* owner,
                   Napi::ObjectReference owner_ref, std::string model_bytes)
      : Napi::AsyncWorker(env, "ortools-cpsat-solve"),
        owner_(owner),
        owner_ref_(std::move(owner_ref)),
        model_bytes_(std::move(model_bytes)),
        deferred_(Napi::Promise::Deferred::New(env)) {}

  Napi::Promise Promise() { return deferred_.Promise(); }

  void Execute() override {
    sat::CpModelProto req;
    if (!req.ParseFromArray(model_bytes_.data(), model_bytes_.size())) {
      SetError("invalid CpModelProto bytes");
      return;
    }
    if (owner_ == nullptr || owner_->native() == nullptr || !owner_->alive()) {
      SetError("SolveWrapper destroyed before solve started");
      return;
    }
    sat::CpSolverResponse res = owner_->native()->Solve(req);
    res.SerializeToString(&response_bytes_);
    // Solve() has returned, so all solution callbacks have been enqueued (no
    // solver threads remain). Block here until the JS thread has dispatched
    // every one of them, so OnOK resolves the promise only after the user's
    // callback has seen all solutions -- matching the other bindings.
    if (owner_ != nullptr) owner_->WaitForCallbackDispatchDrain();
  }

  void OnOK() override {
    Napi::Env env = Env();
    Napi::HandleScope scope(env);
    Napi::Buffer<uint8_t> buf = Napi::Buffer<uint8_t>::Copy(
        env, reinterpret_cast<const uint8_t*>(response_bytes_.data()),
        response_bytes_.size());
    // Release TSFNs now that the solve is complete. Doing this here rather
    // than in ~SolveWrapperJs lets us deterministically drain TSFN queues
    // before the JS thread proceeds -- matches the Python/Java single-solve
    // lifecycle and prevents test frameworks (e.g. vitest) from seeing
    // lingering TSFNs at teardown.
    if (owner_ != nullptr) owner_->ReleaseCallbackTsfns();
    deferred_.Resolve(buf);
    owner_ref_.Reset();
  }

  void OnError(const Napi::Error& err) override {
    if (owner_ != nullptr) owner_->ReleaseCallbackTsfns();
    deferred_.Reject(err.Value());
    owner_ref_.Reset();
  }

 private:
  SolveWrapperJs* owner_;
  Napi::ObjectReference owner_ref_;  // Pins the wrapper for the solve duration.
  std::string model_bytes_;
  std::string response_bytes_;
  Napi::Promise::Deferred deferred_;
};

}  // namespace

// ----------------------------------------------------------------------------
// SolveWrapperJs implementation
// ----------------------------------------------------------------------------

Napi::Function SolveWrapperJs::Init(Napi::Env env) {
  return DefineClass(
      env, "SolveWrapper",
      {
          InstanceMethod("setParametersBytes",
                         &SolveWrapperJs::SetParametersBytes),
          InstanceMethod("setStringParameters",
                         &SolveWrapperJs::SetStringParameters),
          InstanceMethod("addLogCallback", &SolveWrapperJs::AddLogCallback),
          InstanceMethod("addBestBoundCallback",
                         &SolveWrapperJs::AddBestBoundCallback),
          InstanceMethod("addSolutionCallback",
                         &SolveWrapperJs::AddSolutionCallback),
          InstanceMethod("clearSolutionCallback",
                         &SolveWrapperJs::ClearSolutionCallback),
          InstanceMethod("solve", &SolveWrapperJs::Solve),
          InstanceMethod("stopSearch", &SolveWrapperJs::StopSearch),
      });
}

SolveWrapperJs::SolveWrapperJs(const Napi::CallbackInfo& info)
    : Napi::ObjectWrap<SolveWrapperJs>(info),
      wrapper_(std::make_unique<sat::SolveWrapper>()),
      alive_(true),
      solve_in_flight_(false),
      solve_done_(false),
      dispatch_tracker_(std::make_shared<CallbackDispatchTracker>()) {}

SolveWrapperJs::~SolveWrapperJs() { Cleanup(); }

void SolveWrapperJs::ReleaseCallbackTsfns() {
  std::lock_guard<std::mutex> lock(mu_);
  for (auto& tsfn : log_tsfns_) tsfn.Release();
  log_tsfns_.clear();
  for (auto& tsfn : best_bound_tsfns_) tsfn.Release();
  best_bound_tsfns_.clear();
  // Detach (don't delete) each solution bridge: the TSFN finalizer is the
  // sole owner and will free the bridge once any queued payloads have been
  // drained on the JS thread. Eager deletion here would dangle pointers held
  // by in-flight payloads and segfault when the queue is drained at
  // teardown.
  for (auto* bridge : solution_bridges_) bridge->Detach();
  solution_bridges_.clear();
}

void SolveWrapperJs::WaitForCallbackDispatchDrain() {
  if (dispatch_tracker_) dispatch_tracker_->Wait();
}

void SolveWrapperJs::Cleanup() {
  if (!alive_.exchange(false)) return;
  ReleaseCallbackTsfns();
  wrapper_.reset();
}

Napi::Value SolveWrapperJs::SetParametersBytes(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || (!info[0].IsBuffer() && !info[0].IsTypedArray())) {
    Napi::TypeError::New(env, "setParametersBytes(buffer) requires a Uint8Array")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }
  Napi::Uint8Array u8 = info[0].As<Napi::Uint8Array>();
  sat::SatParameters params;
  if (u8.ByteLength() > 0 &&
      !params.ParseFromArray(u8.Data(), static_cast<int>(u8.ByteLength()))) {
    Napi::RangeError::New(env, "invalid SatParameters bytes")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }
  wrapper_->SetParameters(params);
  return env.Undefined();
}

Napi::Value SolveWrapperJs::SetStringParameters(
    const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsString()) {
    Napi::TypeError::New(env, "setStringParameters(text) requires a string")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }
  std::string text = info[0].As<Napi::String>().Utf8Value();
  wrapper_->SetStringParameters(text);
  return env.Undefined();
}

Napi::Value SolveWrapperJs::AddLogCallback(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (!info[0].IsFunction()) {
    Napi::TypeError::New(env, "addLogCallback(fn) requires a function")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }
  Napi::Function fn = info[0].As<Napi::Function>();
  Napi::ThreadSafeFunction tsfn = Napi::ThreadSafeFunction::New(
      env, fn, "ortools-log-cb", /*max_queue_size=*/0,
      /*initial_thread_count=*/1);
  tsfn.Unref(env);
  {
    std::lock_guard<std::mutex> lock(mu_);
    log_tsfns_.push_back(tsfn);
  }
  // Capture by value: TSFN is reference-counted, safe to move into the
  // lambda. The lambda lives in the SolverLogger; teardown happens when
  // SolveWrapper is destroyed in Cleanup().
  wrapper_->AddLogCallback([tsfn](const std::string& message) {
    std::string* copy = new std::string(message);
    auto status = tsfn.NonBlockingCall(
        copy, [](Napi::Env env, Napi::Function jsfn, std::string* msg) {
          std::unique_ptr<std::string> owned(msg);
          if (env == nullptr) return;
          jsfn.Call({Napi::String::New(env, *owned)});
        });
    if (status != napi_ok) {
      delete copy;
    }
  });
  return env.Undefined();
}

Napi::Value SolveWrapperJs::AddBestBoundCallback(
    const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (!info[0].IsFunction()) {
    Napi::TypeError::New(env, "addBestBoundCallback(fn) requires a function")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }
  Napi::Function fn = info[0].As<Napi::Function>();
  Napi::ThreadSafeFunction tsfn = Napi::ThreadSafeFunction::New(
      env, fn, "ortools-bestbound-cb", /*max_queue_size=*/0,
      /*initial_thread_count=*/1);
  tsfn.Unref(env);
  {
    std::lock_guard<std::mutex> lock(mu_);
    best_bound_tsfns_.push_back(tsfn);
  }
  // Track best-bound dispatches in the same counter as solution callbacks so
  // WaitForCallbackDispatchDrain() also waits for them: without this, a fast
  // solve resolves before a queued best-bound update is delivered, dropping it
  // (the reference bindings deliver every bound synchronously before returning).
  auto tracker = dispatch_tracker_;
  wrapper_->AddBestBoundCallback([tsfn, tracker](double bound) {
    double* copy = new double(bound);
    if (tracker) tracker->Begin();
    auto status = tsfn.NonBlockingCall(
        copy, [tracker](Napi::Env env, Napi::Function jsfn, double* d) {
          std::unique_ptr<double> owned(d);
          // Decrement on every path (including env==nullptr teardown) so the
          // drain can't hang.
          struct DrainGuard {
            std::shared_ptr<CallbackDispatchTracker> t;
            ~DrainGuard() {
              if (t) t->End();
            }
          } drain_guard{tracker};
          if (env == nullptr) return;
          jsfn.Call({Napi::Number::New(env, *owned)});
        });
    if (status != napi_ok) {
      delete copy;
      if (tracker) tracker->End();
    }
  });
  return env.Undefined();
}

Napi::Value SolveWrapperJs::AddSolutionCallback(
    const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (!info[0].IsObject()) {
    Napi::TypeError::New(
        env, "addSolutionCallback(target) requires an object with onSolutionCallback")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }
  Napi::Object target = info[0].As<Napi::Object>();
  Napi::Value on_sol_v = target.Get("onSolutionCallback");
  if (!on_sol_v.IsFunction()) {
    Napi::TypeError::New(
        env, "addSolutionCallback target must expose onSolutionCallback")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }
  // The bridge is owned by its own TSFN; we keep a non-owning pointer so we
  // can Detach() it after solve completes. See SolutionBridge for lifetime
  // details.
  SolutionBridge* bridge = SolutionBridge::Create(
      env, target, on_sol_v.As<Napi::Function>(), dispatch_tracker_);
  wrapper_->AddSolutionCallback(*bridge);
  {
    std::lock_guard<std::mutex> lock(mu_);
    solution_bridges_.push_back(bridge);
  }
  return env.Undefined();
}

Napi::Value SolveWrapperJs::ClearSolutionCallback(
    const Napi::CallbackInfo& info) {
  // We don't expose a finer-grained API; this is a hint to release after
  // solve. The destructors do the right thing.
  return info.Env().Undefined();
}

Napi::Value SolveWrapperJs::Solve(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (solve_in_flight_.exchange(true)) {
    Napi::Error::New(env, "solve already in progress on this SolveWrapper")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }
  if (info.Length() < 1 || !info[0].IsTypedArray()) {
    Napi::TypeError::New(env, "solve(modelBytes) requires a Uint8Array")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }
  Napi::Uint8Array u8 = info[0].As<Napi::Uint8Array>();
  std::string bytes(reinterpret_cast<const char*>(u8.Data()), u8.ByteLength());

  Napi::ObjectReference self_ref =
      Napi::Persistent(info.This().As<Napi::Object>());
  auto* worker =
      new SolveAsyncWorker(env, this, std::move(self_ref), std::move(bytes));
  Napi::Promise promise = worker->Promise();
  worker->Queue();
  return promise;
}

Napi::Value SolveWrapperJs::StopSearch(const Napi::CallbackInfo& info) {
  if (alive_.load() && wrapper_) {
    wrapper_->StopSearch();
  }
  return info.Env().Undefined();
}

Napi::Object InitSolveWrapper(Napi::Env env, Napi::Object exports) {
  Napi::Function ctor = SolveWrapperJs::Init(env);
  // Persist the constructor so the class lives as long as the env.
  auto* ref = new Napi::FunctionReference();
  *ref = Napi::Persistent(ctor);
  ref->SuppressDestruct();
  exports.Set("SolveWrapper", ctor);
  return exports;
}

}  // namespace operations_research::sat::node_binding
