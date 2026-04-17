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

#include "ortools/node/src/cpp/solve_wrapper.h"

#include <atomic>
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
// Solution callback bridge
// ----------------------------------------------------------------------------
//
// The native sat::SolutionCallback's OnSolutionCallback is invoked by a SAT
// worker thread. We must not touch v8 from there. The bridge:
//   * snapshots SharedResponse() (a shared_ptr<CpSolverResponse>),
//   * dispatches to the JS thread via a TSFN with BlockingCall (back-pressure
//     -- slow JS callbacks throttle the solver, which is what we want),
//   * the JS-side dispatcher constructs a frozen "context" object and invokes
//     onSolutionCallback(ctx) on the user's target.
//
// The bridge owns:
//   * a Napi::ThreadSafeFunction (released on Cleanup)
//   * a Napi::FunctionReference to the user's onSolutionCallback (released
//     when the bridge is destroyed).

class SolveWrapperJs::SolutionBridge : public sat::SolutionCallback {
 public:
  SolutionBridge(Napi::Env env, Napi::Object target_obj,
                 Napi::Function on_solution_fn) {
    target_ref_ = Napi::Persistent(target_obj);
    on_solution_ref_ = Napi::Persistent(on_solution_fn);
    tsfn_ = Napi::ThreadSafeFunction::New(
        env, on_solution_fn, "ortools-solution-cb",
        /*max_queue_size=*/0, /*initial_thread_count=*/1);
    tsfn_.Unref(env);
  }

  ~SolutionBridge() override {
    if (released_.exchange(true)) return;
    tsfn_.Release();
  }

  // Returns the underlying JS object we use as a stable identity for
  // ClearSolutionCallback on the JS side.
  napi_value identity_value(Napi::Env env) const { return target_ref_.Value(); }

  // Called from a SAT worker thread.
  void OnSolutionCallback() const override {
    auto resp = SharedResponse();
    if (!resp) return;

    // Capture the wrapper pointer so the JS dispatcher can call back into
    // SolveWrapper::StopSearch() if the user's callback requests it.
    sat::SolveWrapper* w = wrapper();

    auto status = tsfn_.BlockingCall(
        new Payload{resp, w, &target_ref_, &on_solution_ref_},
        &SolutionBridge::DispatchOnJsThread);
    if (status != napi_ok) {
      // TSFN closed (e.g. user dropped the callback mid-solve). Stop quietly.
      // The leaked Payload is fine because nothing was queued.
    }
  }

 private:
  struct Payload {
    std::shared_ptr<sat::CpSolverResponse> response;
    sat::SolveWrapper* wrapper;
    const Napi::Reference<Napi::Object>* target_ref;
    const Napi::Reference<Napi::Function>* fn_ref;
  };

  static void DispatchOnJsThread(Napi::Env env, Napi::Function /*noop*/,
                                 Payload* payload) {
    std::unique_ptr<Payload> p(payload);
    if (env == nullptr || !p) return;

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
  mutable std::atomic<bool> released_{false};
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
      solve_done_(false) {}

SolveWrapperJs::~SolveWrapperJs() { Cleanup(); }

void SolveWrapperJs::ReleaseCallbackTsfns() {
  std::lock_guard<std::mutex> lock(mu_);
  for (auto& tsfn : log_tsfns_) tsfn.Release();
  log_tsfns_.clear();
  for (auto& tsfn : best_bound_tsfns_) tsfn.Release();
  best_bound_tsfns_.clear();
  solution_bridges_.clear();
}

void SolveWrapperJs::Cleanup() {
  if (!alive_.exchange(false)) return;
  ReleaseCallbackTsfns();
  wrapper_.reset();
}

Napi::Value SolveWrapperJs::SetParametersBytes(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsBuffer() && !info[0].IsTypedArray()) {
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
  wrapper_->AddBestBoundCallback([tsfn](double bound) {
    double* copy = new double(bound);
    auto status = tsfn.NonBlockingCall(
        copy, [](Napi::Env env, Napi::Function jsfn, double* d) {
          std::unique_ptr<double> owned(d);
          if (env == nullptr) return;
          jsfn.Call({Napi::Number::New(env, *owned)});
        });
    if (status != napi_ok) {
      delete copy;
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
  auto bridge = std::make_unique<SolutionBridge>(
      env, target, on_sol_v.As<Napi::Function>());
  wrapper_->AddSolutionCallback(*bridge);
  {
    std::lock_guard<std::mutex> lock(mu_);
    solution_bridges_.push_back(std::move(bridge));
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
