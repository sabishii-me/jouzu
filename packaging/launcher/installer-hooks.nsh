!define JOUZU_HOOK_DIRECTORY "${__FILEDIR__}"
Var JouzuPreparationFailures

!macro JOUZU_PREPARE_COMPONENT COMPONENT
  nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$INSTDIR\runtime\launcher-update\prepare-component.ps1" -InstallRoot "$INSTDIR" -Component ${COMPONENT}'
  Pop $0
  Pop $1
  ${If} $0 != 0
    StrCpy $JouzuPreparationFailures "$JouzuPreparationFailures${COMPONENT}: $1$\r$\n"
  ${EndIf}
!macroend

!macro JOUZU_LAUNCHER_ONLY_REPLACE
  InitPluginsDir
  File /oname=$PLUGINSDIR\replace-locked-launcher-files.ps1 "${JOUZU_HOOK_DIRECTORY}\replace-locked-launcher-files.ps1"
  nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\replace-locked-launcher-files.ps1" -InstallRoot "$INSTDIR"'
  Pop $0
  Pop $1
  ${If} $0 != 0
    SetErrorLevel 1
    IfSilent +2
    MessageBox MB_OK|MB_ICONSTOP "$1"
    Abort
  ${EndIf}
!macroend

!macro JOUZU_STOP_ALL
  IfSilent +3
  MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION "$(jouzuCloseSessions)" IDOK +2
  Abort
  InitPluginsDir
  File /oname=$PLUGINSDIR\stop-managed-processes.ps1 "${JOUZU_HOOK_DIRECTORY}\stop-managed-processes.ps1"
  ${If} $UpdateMode = 1
  nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\stop-managed-processes.ps1" -RefuseActiveSessions -InstallRoot "$INSTDIR"'
  ${Else}
  nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\stop-managed-processes.ps1" -InstallRoot "$INSTDIR"'
  ${EndIf}
  Pop $0
  Pop $1
  ${If} $0 != 0
    SetErrorLevel 1
    IfSilent +2
    MessageBox MB_OK|MB_ICONSTOP "$(jouzuCloseFailed)"
    Abort
  ${EndIf}
!macroend

!macro JOUZU_STOP_MANAGED
!if ${JOUZU_LAUNCHER_ONLY} == 1
  ; A launcher-only package leaves the payload in place, so running sessions stay open; only
  ; locked launcher-owned executables are renamed aside for replacement.
  !insertmacro JOUZU_LAUNCHER_ONLY_REPLACE
!else
  !insertmacro JOUZU_STOP_ALL
!endif
!macroend

!macro NSIS_HOOK_PREINSTALL
  !insertmacro JOUZU_STOP_MANAGED
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  ; Removing the installation deletes its files, so the launcher has to stop as well. The
  ; launcher-only package's keep-sessions behaviour belongs to replacing files during an update,
  ; not to an uninstall that would otherwise delete files from under a running launcher.
  !insertmacro JOUZU_STOP_ALL
  ${If} $UpdateMode <> 1
    ; Remove the command directory from PATH while its helper is still installed.
    IfFileExists "$INSTDIR\runtime\launcher-update\command-path.ps1" 0 jouzu_path_gone
      nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$INSTDIR\runtime\launcher-update\command-path.ps1" -Directory "$LOCALAPPDATA\Shisa.ai\Jouzu\bin" -Action Remove -Write'
      Pop $0
      Pop $1
    jouzu_path_gone:
  ${EndIf}
!macroend

!macro JOUZU_EXTRACT_APP
  IfFileExists "$INSTDIR\app.tgz" 0 jouzu_app_done
    ; The archive carries the npm-installed tree without MAX_PATH limits in NSIS.
    RmDir /r "\\?\$INSTDIR\app"
    nsExec::ExecToStack '"$SYSDIR\tar.exe" -xzf "$INSTDIR\app.tgz" -C "$INSTDIR"'
    Pop $0
    Pop $1
    Delete "$INSTDIR\app.tgz"
    ${If} $0 != 0
      SetErrorLevel 1
      IfSilent +2
      MessageBox MB_OK|MB_ICONSTOP "Jouzu application files could not be installed."
      Abort
    ${EndIf}
  jouzu_app_done:
!macroend

!macro NSIS_HOOK_POSTINSTALL
  !insertmacro JOUZU_EXTRACT_APP
!if ${JOUZU_LAUNCHER_ONLY} == 0
  ; Only the full installer prepares components. A launcher-only update must not replace them.
  StrCpy $JouzuPreparationFailures ""
  !insertmacro JOUZU_PREPARE_COMPONENT git
  !insertmacro JOUZU_PREPARE_COMPONENT terminal
  ${If} $JouzuPreparationFailures != ""
    DetailPrint "$(jouzuPrepareFailed)"
    ; Installation completes with repair available. Silent callers can detect partial completion.
    SetErrorLevel 2
    ${If} $PassiveMode != 1
      IfSilent +2
      MessageBox MB_OK|MB_ICONEXCLAMATION "$(jouzuPrepareFailed)"
    ${EndIf}
  ${EndIf}
!endif
  ; The terminal entries are byte copies of the signed console, so no second binary ships. A copy that
  ; could not be refreshed leaves the previous one in place; the System section reports the state.
  IfFileExists "$INSTDIR\runtime\launcher-update\command-entries.ps1" 0 jouzu_entries_done
    nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$INSTDIR\runtime\launcher-update\command-entries.ps1" -InstallRoot "$INSTDIR"'
    Pop $0
    Pop $1
  jouzu_entries_done:
  ; The terminal entries are names in a per-user directory that one PATH entry points at. The entry is
  ; added by default, at an install and at an update alike: adding it again writes nothing, and it is
  ; added only when neither name would answer from another installation first.
  IfFileExists "$INSTDIR\runtime\launcher-update\command-path.ps1" 0 jouzu_path_done
    nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$INSTDIR\runtime\launcher-update\command-path.ps1" -Directory "$LOCALAPPDATA\Shisa.ai\Jouzu\bin" -Action Install -InstallRoot "$INSTDIR"'
    Pop $0
    Pop $1
    nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$INSTDIR\runtime\launcher-update\command-path.ps1" -Directory "$LOCALAPPDATA\Shisa.ai\Jouzu\bin" -Action Append -Write'
    Pop $0
    Pop $1
  jouzu_path_done:
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ${If} $UpdateMode <> 1
    RmDir /r "\\?\$LOCALAPPDATA\Shisa.ai\Jouzu\bin"
    ; A launcher-only package does not carry the payload file list, so remove it explicitly. An
    ; update keeps the payload: it replaces the launcher, it does not remove the installation.
    RmDir /r "\\?\$INSTDIR\app"
    Delete "$INSTDIR\app.tgz"
    RmDir /r "\\?\$INSTDIR\runtime"
    ; The terminal entries are copies the installer created, so the file manifest does not know them.
    Delete "$INSTDIR\jz.exe"
    Delete "$INSTDIR\jouzu.exe"
    Delete "$INSTDIR\*.old-*"
    ; Leftovers mean something still holds these files, usually a launcher or a session that
    ; started again, so the uninstall says so instead of reporting success.
    ${If} ${FileExists} "$INSTDIR\app\*.*"
    ${OrIf} ${FileExists} "$INSTDIR\runtime\*.*"
    ${OrIf} ${FileExists} "$INSTDIR\jz.exe"
    ${OrIf} ${FileExists} "$INSTDIR\jouzu.exe"
    ${OrIf} ${FileExists} "$INSTDIR\*.old-*"
      SetErrorLevel 1
      IfSilent +2
      MessageBox MB_OK|MB_ICONSTOP "$(jouzuRemoveFailed)"
    ${EndIf}
  ${EndIf}
!macroend
