# Ouvre l'accès à l'application depuis les téléphones et tablettes du même réseau.
# Lancé par OUVRIR-ACCES-TELEPHONE.bat (en administrateur).
$Port = 3000
Write-Host ""
Write-Host "=== Accès depuis les téléphones / tablettes ===" -ForegroundColor Cyan
Write-Host ""

# 1. Supprimer les règles du pare-feu qui BLOQUENT Node.js (créées si on a refusé la fenêtre de Windows)
$bloquantes = Get-NetFirewallRule -Direction Inbound -Action Block -ErrorAction SilentlyContinue |
  Where-Object { $_.DisplayName -match 'node' }
foreach ($r in $bloquantes) {
  Write-Host "  Règle qui bloquait l'application supprimée : $($r.DisplayName)" -ForegroundColor Yellow
  Remove-NetFirewallRule -Name $r.Name -ErrorAction SilentlyContinue
}

# 2. Autoriser l'application (port + programme node.exe), pour tous les types de réseau
Remove-NetFirewallRule -DisplayName 'Autorisations de sortie (port)' -ErrorAction SilentlyContinue
New-NetFirewallRule -DisplayName 'Autorisations de sortie (port)' -Direction Inbound -Protocol TCP -LocalPort $Port,3443 -Action Allow -Profile Any | Out-Null
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if ($node) {
  Remove-NetFirewallRule -DisplayName 'Autorisations de sortie (Node.js)' -ErrorAction SilentlyContinue
  New-NetFirewallRule -DisplayName 'Autorisations de sortie (Node.js)' -Direction Inbound -Program $node -Action Allow -Profile Any | Out-Null
}
Write-Host "  [OK] Pare-feu Windows : accès autorisé (port $Port)." -ForegroundColor Green

# 3. Type de réseau
Write-Host ""
Get-NetConnectionProfile -ErrorAction SilentlyContinue | ForEach-Object {
  $type = if ($_.NetworkCategory -eq 'Public') { 'Public' } else { 'Privé' }
  Write-Host "  Réseau : $($_.Name) ($($_.InterfaceAlias)) - type $type"
}

# 4. L'application est-elle lancée ?
Write-Host ""
try {
  Invoke-WebRequest "http://localhost:$Port/api/auth/public" -UseBasicParsing -TimeoutSec 3 | Out-Null
  Write-Host "  [OK] L'application est en marche." -ForegroundColor Green
} catch {
  Write-Host "  [!] L'application n'est PAS lancée : double-cliquez d'abord sur DEMARRER-DEMO.bat." -ForegroundColor Red
}

# 5. Adresses à taper sur le téléphone
Write-Host ""
Write-Host "  Sur le téléphone (connecté au MÊME Wi-Fi, pas en 4G), ouvrez Chrome et tapez :" -ForegroundColor Cyan
Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
  Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } |
  Sort-Object { if ($_.InterfaceAlias -match 'vEthernet|VirtualBox|VMware|VPN|Bluetooth') { 1 } else { 0 } } |
  ForEach-Object { Write-Host ("     http://{0}:{1}      ({2})" -f $_.IPAddress, $Port, $_.InterfaceAlias) -ForegroundColor White }
Write-Host ""
Write-Host "  Essayez la première adresse. Si la page ne s'ouvre pas, essayez la suivante."
Write-Host "  Toujours rien ? Le Wi-Fi isole peut-être les appareils (Wi-Fi « invités »),"
Write-Host "  ou un antivirus (Kaspersky, Avast, ESET...) a son propre pare-feu : autorisez-y Node.js."
Write-Host ""
