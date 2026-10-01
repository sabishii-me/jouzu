!define JOUZU_HOOK_DIRECTORY "${__FILEDIR__}"
!macro JOUZU_STOP_MANAGED
  IfSilent +3
  MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION "Setup must close Jouzu and its running agent commands before continuing. Save your work first." IDOK +2
  Abort
  InitPluginsDir
  File /oname=$PLUGINSDIR\stop-managed-processes.ps1 "${JOUZU_HOOK_DIRECTORY}\stop-managed-processes.ps1"
  nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\stop-managed-processes.ps1" -InstallRoot "$INSTDIR"'
  Pop $0
  Pop $1
  ${If} $0 != 0
    MessageBox MB_OK|MB_ICONSTOP "Cannot safely close Jouzu. No installation files will be changed.$\r$\n$1"
    Abort
  ${EndIf}
!macroend

!macro NSIS_HOOK_PREINSTALL
  StrCpy $INSTDIR "$LOCALAPPDATA\Shisa.ai\Jouzu"
  SetOutPath $INSTDIR
  !insertmacro JOUZU_STOP_MANAGED
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro JOUZU_STOP_MANAGED
!macroend

!macro NSIS_HOOK_POSTINSTALL
  File /oname=$PLUGINSDIR\remove-legacy-payload.ps1 "${JOUZU_HOOK_DIRECTORY}\remove-legacy-payload.ps1"
  nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\remove-legacy-payload.ps1" -InstallRoot "$INSTDIR"'
  Pop $0
  Pop $1
  ${If} $0 != 0
    MessageBox MB_OK|MB_ICONEXCLAMATION "Jouzu was installed, but obsolete preview files could not be removed.$\r$\n$1"
  ${EndIf}
!macroend
