@echo off
chcp 65001 >nul
title Initialiser la base avec le VRAI personnel
cd /d "%~dp0"
echo.
echo  ===== Initialisation avec le vrai personnel =====
echo.
where node >nul 2>nul
if errorlevel 1 (
  echo  [ERREUR] Node.js n'est pas installe : https://nodejs.org
  pause
  exit /b 1
)
netstat -ano | findstr /R /C:":3000 .*LISTENING" >nul
if not errorlevel 1 (
  echo  [ATTENTION] L'application est ouverte : fermez d'abord sa fenetre noire, puis relancez ce fichier.
  pause
  exit /b 1
)
rem Fichier Excel : glisse sur ce fichier, ou " base.xlsx " place dans ce dossier
set "FICHIER=%~1"
if "%FICHIER%"=="" set "FICHIER=%~dp0base.xlsx"
if not exist "%FICHIER%" (
  echo  [ERREUR] Fichier du personnel introuvable.
  echo  Copiez votre fichier Excel dans ce dossier sous le nom  base.xlsx
  echo  ^(ou glissez le fichier Excel sur INITIALISER-BASE-REELLE.bat^).
  pause
  exit /b 1
)
echo  Fichier du personnel : %FICHIER%
echo.
echo  Les donnees actuelles ^(demonstration^) vont etre MISES DE COTE dans un dossier
echo  " data-ancienne-... " ^(rien n'est efface definitivement^), puis le vrai
echo  personnel sera charge avec les nouveaux comptes.
echo.
choice /C ON /M "  Continuer"
if errorlevel 2 exit /b 0
if not exist node_modules\express (
  echo  Installation des composants...
  call npm install
)
for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd-HHmmss"') do set TS=%%i
if exist data move data "data-ancienne-%TS%" >nul
if exist "data-ancienne-%TS%" echo  Anciennes donnees mises de cote : data-ancienne-%TS%
call npm run -s init:reel -- "%FICHIER%"
if errorlevel 1 (
  echo  [ERREUR] Import impossible : voir le message ci-dessus.
  pause
  exit /b 1
)
echo.
echo  Termine. Lancez maintenant DEMARRER.bat pour utiliser l'application.
echo.
pause
