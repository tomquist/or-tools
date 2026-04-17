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

// Thin binding around the sat/c_api/cp_solver_c.h "fire-and-forget" entry
// point. Useful as a behavioral oracle for tests; not part of the public TS
// API surface.

#include <cstdint>
#include <cstdlib>
#include <string>
#include <utility>

#include <napi.h>

#include "ortools/sat/c_api/cp_solver_c.h"

namespace operations_research::sat::node_binding {

namespace {

class CApiAsyncWorker : public Napi::AsyncWorker {
 public:
  CApiAsyncWorker(Napi::Env env, std::string model_bytes,
                  std::string params_bytes)
      : Napi::AsyncWorker(env, "ortools-cpsat-c-api"),
        model_bytes_(std::move(model_bytes)),
        params_bytes_(std::move(params_bytes)),
        deferred_(Napi::Promise::Deferred::New(env)) {}

  Napi::Promise Promise() { return deferred_.Promise(); }

  void Execute() override {
    void* res_ptr = nullptr;
    int res_len = 0;
    SolveCpModelWithParameters(model_bytes_.data(),
                               static_cast<int>(model_bytes_.size()),
                               params_bytes_.data(),
                               static_cast<int>(params_bytes_.size()),
                               &res_ptr, &res_len);
    if (res_ptr != nullptr && res_len > 0) {
      response_bytes_.assign(static_cast<const char*>(res_ptr), res_len);
      std::free(res_ptr);
    }
  }

  void OnOK() override {
    Napi::Env env = Env();
    Napi::HandleScope scope(env);
    Napi::Buffer<uint8_t> buf = Napi::Buffer<uint8_t>::Copy(
        env, reinterpret_cast<const uint8_t*>(response_bytes_.data()),
        response_bytes_.size());
    deferred_.Resolve(buf);
  }

  void OnError(const Napi::Error& err) override {
    deferred_.Reject(err.Value());
  }

 private:
  std::string model_bytes_;
  std::string params_bytes_;
  std::string response_bytes_;
  Napi::Promise::Deferred deferred_;
};

bool ToBuffer(const Napi::Value& v, std::string* out) {
  if (!v.IsTypedArray()) return false;
  Napi::Uint8Array u8 = v.As<Napi::Uint8Array>();
  out->assign(reinterpret_cast<const char*>(u8.Data()), u8.ByteLength());
  return true;
}

Napi::Value Solve(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  std::string model;
  std::string params;
  if (!ToBuffer(info[0], &model) || !ToBuffer(info[1], &params)) {
    Napi::TypeError::New(env,
                         "cApi.solve(modelBytes, paramsBytes) requires two "
                         "Uint8Array arguments")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }
  auto* worker =
      new CApiAsyncWorker(env, std::move(model), std::move(params));
  Napi::Promise promise = worker->Promise();
  worker->Queue();
  return promise;
}

}  // namespace

Napi::Object InitCApi(Napi::Env env, Napi::Object exports) {
  Napi::Object c_api = Napi::Object::New(env);
  c_api.Set("solve", Napi::Function::New(env, Solve));
  exports.Set("cApi", c_api);
  return exports;
}

}  // namespace operations_research::sat::node_binding
