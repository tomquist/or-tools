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

#ifndef ORTOOLS_NODE_SRC_CPP_SOLVE_WRAPPER_H_
#define ORTOOLS_NODE_SRC_CPP_SOLVE_WRAPPER_H_

#include <atomic>
#include <memory>
#include <mutex>
#include <vector>

#include <napi.h>

#include "ortools/sat/swig_helper.h"

namespace operations_research::sat::node_binding {

// JS-facing wrapper around operations_research::sat::SolveWrapper.
//
// One JS instance corresponds to one solve cycle. After solve() resolves the
// wrapper is considered consumed -- subsequent solve() calls throw. Mirrors
// the Python/Java single-use-per-solve convention.
class SolveWrapperJs : public Napi::ObjectWrap<SolveWrapperJs> {
 public:
  static Napi::Function Init(Napi::Env env);
  explicit SolveWrapperJs(const Napi::CallbackInfo& info);
  ~SolveWrapperJs() override;

  sat::SolveWrapper* native() { return wrapper_.get(); }
  bool alive() const { return alive_.load(); }
  /** Releases the log + best-bound + solution TSFNs owned by this wrapper. */
  void ReleaseCallbackTsfns();

 private:
  // JS-exposed methods.
  Napi::Value SetParametersBytes(const Napi::CallbackInfo& info);
  Napi::Value SetStringParameters(const Napi::CallbackInfo& info);
  Napi::Value AddLogCallback(const Napi::CallbackInfo& info);
  Napi::Value AddBestBoundCallback(const Napi::CallbackInfo& info);
  Napi::Value AddSolutionCallback(const Napi::CallbackInfo& info);
  Napi::Value ClearSolutionCallback(const Napi::CallbackInfo& info);
  Napi::Value Solve(const Napi::CallbackInfo& info);
  Napi::Value StopSearch(const Napi::CallbackInfo& info);

  // Releases all TSFNs and the underlying SolveWrapper. Idempotent.
  void Cleanup();

  std::unique_ptr<sat::SolveWrapper> wrapper_;

  // alive_ guards stopSearch() against post-destruction calls and against
  // races with the worker tearing down.
  std::atomic<bool> alive_;

  // True once a solve has been started; prevents repeated solves on the same
  // wrapper, mirroring Python's per-solve lock semantics.
  std::atomic<bool> solve_in_flight_;
  std::atomic<bool> solve_done_;

  // Solution-callback bridge owns its own TSFN and target ref.
  class SolutionBridge;
  std::vector<std::unique_ptr<SolutionBridge>> solution_bridges_;

  // Log + best-bound TSFNs, released in Cleanup().
  std::vector<Napi::ThreadSafeFunction> log_tsfns_;
  std::vector<Napi::ThreadSafeFunction> best_bound_tsfns_;

  // Guards the lists above against concurrent Cleanup vs. callback paths.
  std::mutex mu_;
};

}  // namespace operations_research::sat::node_binding

#endif  // ORTOOLS_NODE_SRC_CPP_SOLVE_WRAPPER_H_
