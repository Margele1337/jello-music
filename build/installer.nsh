!include "MUI.nsh"

!define MUI_FINISHPAGE_LINK_LOCATION "https://github.com/Margele1337/jello-music"
!define MUI_FINISHPAGE_LINK "访问作者(阿珏酱)主页"
!define MUI_FINISHPAGE_SHOWREADME_TEXT "访问 GitHub 项目主页"
!define MUI_FINISHPAGE_SHOWREADME "https://github.com/Margele1337/jello-music"
!insertmacro MUI_PAGE_WELCOME

; Register the jello:// protocol
!macro customInstall
  DeleteRegKey HKCR "jello"
  WriteRegStr HKCR "jello" "" "URL:Jello Music Protocol"
  WriteRegStr HKCR "jello" "URL Protocol" ""
  WriteRegStr HKCR "jello\DefaultIcon" "" "$INSTDIR\${PRODUCT_NAME}.exe,0"
  WriteRegStr HKCR "jello\shell" "" ""
  WriteRegStr HKCR "jello\shell\open" "" ""
  WriteRegStr HKCR "jello\shell\open\command" "" '"$INSTDIR\${PRODUCT_NAME}.exe" "%1"'

  SetShellVarContext all
  Delete "$DESKTOP\${PRODUCT_NAME}.lnk"
  SetShellVarContext current
  CreateShortCut "$DESKTOP\${PRODUCT_NAME}.lnk" "$INSTDIR\${PRODUCT_NAME}.exe"
  SetShellVarContext all
!macroend
