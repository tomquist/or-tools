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

#include <cstdint>
#include <string>

#include <napi.h>

#include "ortools/sat/cp_model.pb.h"
#include "ortools/sat/swig_helper.h"
#include "ortools/util/sorted_interval_list.h"

namespace operations_research::sat::node_binding {

namespace {

bool ToBuffer(const Napi::Value& v, std::string* out) {
  if (!v.IsTypedArray()) return false;
  Napi::Uint8Array u8 = v.As<Napi::Uint8Array>();
  out->assign(reinterpret_cast<const char*>(u8.Data()), u8.ByteLength());
  return true;
}

Napi::Value ModelStats(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  std::string bytes;
  if (!ToBuffer(info[0], &bytes)) {
    Napi::TypeError::New(env, "modelStats(modelBytes) requires a Uint8Array")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }
  sat::CpModelProto model;
  if (!model.ParseFromArray(bytes.data(), bytes.size())) {
    Napi::RangeError::New(env, "invalid CpModelProto bytes")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }
  return Napi::String::New(env, sat::CpSatHelper::ModelStats(model));
}

Napi::Value SolverResponseStats(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  std::string bytes;
  if (!ToBuffer(info[0], &bytes)) {
    Napi::TypeError::New(env,
                         "solverResponseStats(responseBytes) requires a Uint8Array")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }
  sat::CpSolverResponse res;
  if (!res.ParseFromArray(bytes.data(), bytes.size())) {
    Napi::RangeError::New(env, "invalid CpSolverResponse bytes")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }
  return Napi::String::New(env, sat::CpSatHelper::SolverResponseStats(res));
}

Napi::Value ValidateModel(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  std::string bytes;
  if (!ToBuffer(info[0], &bytes)) {
    Napi::TypeError::New(env, "validateModel(modelBytes) requires a Uint8Array")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }
  sat::CpModelProto model;
  if (!model.ParseFromArray(bytes.data(), bytes.size())) {
    Napi::RangeError::New(env, "invalid CpModelProto bytes")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }
  return Napi::String::New(env, sat::CpSatHelper::ValidateModel(model));
}

Napi::Value VariableDomain(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  std::string bytes;
  if (!ToBuffer(info[0], &bytes)) {
    Napi::TypeError::New(
        env, "variableDomain(variableProtoBytes) requires a Uint8Array")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }
  sat::IntegerVariableProto var;
  if (!var.ParseFromArray(bytes.data(), bytes.size())) {
    Napi::RangeError::New(env, "invalid IntegerVariableProto bytes")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }
  Domain d = sat::CpSatHelper::VariableDomain(var);
  std::vector<int64_t> flat = d.FlattenedIntervals();
  Napi::Array out = Napi::Array::New(env, flat.size());
  for (size_t i = 0; i < flat.size(); ++i) {
    out.Set(static_cast<uint32_t>(i), Napi::BigInt::New(env, flat[i]));
  }
  return out;
}

Napi::Value WriteModelToFile(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  std::string bytes;
  if (!ToBuffer(info[0], &bytes)) {
    Napi::TypeError::New(
        env, "writeModelToFile(modelBytes, path) requires a Uint8Array")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }
  if (!info[1].IsString()) {
    Napi::TypeError::New(
        env, "writeModelToFile(modelBytes, path) requires a string path")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }
  sat::CpModelProto model;
  if (!model.ParseFromArray(bytes.data(), bytes.size())) {
    Napi::RangeError::New(env, "invalid CpModelProto bytes")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }
  bool ok = sat::CpSatHelper::WriteModelToFile(
      model, info[1].As<Napi::String>().Utf8Value());
  return Napi::Boolean::New(env, ok);
}

}  // namespace

Napi::Object InitCpSatHelper(Napi::Env env, Napi::Object exports) {
  Napi::Object helper = Napi::Object::New(env);
  helper.Set("modelStats", Napi::Function::New(env, ModelStats));
  helper.Set("solverResponseStats",
             Napi::Function::New(env, SolverResponseStats));
  helper.Set("validateModel", Napi::Function::New(env, ValidateModel));
  helper.Set("variableDomain", Napi::Function::New(env, VariableDomain));
  helper.Set("writeModelToFile", Napi::Function::New(env, WriteModelToFile));
  exports.Set("CpSatHelper", helper);
  return exports;
}

}  // namespace operations_research::sat::node_binding
