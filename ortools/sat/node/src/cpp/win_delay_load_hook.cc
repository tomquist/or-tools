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

// Standard delay-load hook so the addon resolves node's symbols against the
// host process (e.g. node.exe, electron.exe, bun.exe) instead of insisting
// that NODE.EXE is on the path. This is the same hook node-gyp emits.

#ifdef _WIN32

#include <delayimp.h>
#include <string.h>
#include <windows.h>

static FARPROC WINAPI load_exe_hook(unsigned int event, DelayLoadInfo* info) {
  if (event != dliNotePreLoadLibrary) {
    return NULL;
  }
  if (_stricmp(info->szDll, "node.exe") != 0) {
    return NULL;
  }
  HMODULE m = GetModuleHandleA(NULL);
  return (FARPROC)m;
}

decltype(__pfnDliNotifyHook2) __pfnDliNotifyHook2 = load_exe_hook;

#endif  // _WIN32
