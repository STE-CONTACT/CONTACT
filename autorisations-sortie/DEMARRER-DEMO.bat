@echo off
chcp 65001 >nul
title Autorisations de sortie - DEMO
cd /d "%~dp0"
echo.
echo  ===== Autorisations de sortie - demonstration =====
echo.
where node >nul 2>nul
if errorlevel 1 (
  echo  [ERREUR] Node.js n'est pas installe.
  echo  Installez la version LTS ^(22 ou plus^) depuis https://nodejs.org puis relancez ce fichier.
  start "" https://nodejs.org
  pause
  exit /b 1
)
for /f "tokens=1 delims=v." %%v in ('node -v') do set NODE_MAJ=%%v
if %NODE_MAJ% LSS 22 (
  echo  [ERREUR] Node.js 22 ou plus recent est necessaire. Version installee :
  node -v
  start "" https://nodejs.org
  pause
  exit /b 1
)
if not exist node_modules (
  echo  Installation des composants ^(une seule fois, 1 a 2 minutes^)...
  call npm install
  if errorlevel 1 (
    echo  [ERREUR] Installation impossible. Verifiez la connexion Internet.
    pause
    exit /b 1
  )
)
if not exist data\sorties.db (
  echo  Creation des donnees de demonstration...
  call npm run seed:demo
)
echo.
echo  L'application s'ouvre dans le navigateur : http://localhost:3000
echo  Comptes : admin / Admin@2026!   -   chef.karim, rh.leila, gardien.ali / Demo@2026!
echo  Pour ARRETER l'application : fermez cette fenetre.
echo.
start "" cmd /c "timeout /t 3 /nobreak >nul & start http://localhost:3000"
call npm start
pause
