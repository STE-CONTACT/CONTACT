@echo off
chcp 65001 >nul
title Autorisations de sortie
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo  [ERREUR] Node.js n'est pas installe : https://nodejs.org
  start "" https://nodejs.org
  pause
  exit /b 1
)
netstat -ano | findstr /R /C:":3000 .*LISTENING" >nul
if not errorlevel 1 (
  echo  [ATTENTION] L'application tourne deja dans une autre fenetre. Fermez-la, puis relancez.
  pause
  exit /b 1
)
if not exist node_modules\express (
  echo  Installation des composants ^(une seule fois^)...
  call npm install
)
if not exist data\sorties.db (
  echo  Aucune base trouvee : lancez d'abord INITIALISER-BASE-REELLE.bat ^(vrai personnel^)
  echo  ou DEMARRER-DEMO.bat ^(donnees de demonstration^).
  pause
  exit /b 1
)
echo.
echo  Application : http://localhost:3000   ^(laisser cette fenetre ouverte^)
echo  Telephones  : scannez le QR de la page de connexion du PC ^(meme Wi-Fi^).
echo.
start "" cmd /c "timeout /t 3 /nobreak >nul & start http://localhost:3000"
call npm start
pause
