!macro NSIS_HOOK_PREINSTALL
  StrCpy $INSTDIR "$LOCALAPPDATA\Shisa.ai\Jouzu"
  SetOutPath $INSTDIR
!macroend
