$ErrorActionPreference='Stop'
$taskRoot=Split-Path $PSScriptRoot -Parent
$taskJava=(Get-ChildItem -LiteralPath (Join-Path $taskRoot '.build-tools') -Directory -Filter 'jdk-*' | Select-Object -First 1).FullName
$taskSigning=Join-Path $env:LOCALAPPDATA 'FinBuddyBuild/signing'
New-Item -ItemType Directory -Force -Path $taskSigning | Out-Null
$taskKey=Join-Path $taskSigning 'fin-buddy-release.p12'
$taskPasswordFile=Join-Path $taskSigning 'password.dpapi'
if(!(Test-Path -LiteralPath $taskKey)) {
 $taskBytes=[byte[]]::new(32)
 [System.Security.Cryptography.RandomNumberGenerator]::Fill($taskBytes)
 $taskPassword=[Convert]::ToBase64String($taskBytes)
 ConvertTo-SecureString $taskPassword -AsPlainText -Force | ConvertFrom-SecureString | Set-Content -LiteralPath $taskPasswordFile
} else {
 if(!(Test-Path -LiteralPath $taskPasswordFile)){throw 'The signing key password is missing. Restore the original signing credentials.'}
 $taskSecure=(Get-Content -LiteralPath $taskPasswordFile -Raw).Trim() | ConvertTo-SecureString
 $taskPassword=[System.Net.NetworkCredential]::new('', $taskSecure).Password
}
$env:JAVA_HOME=$taskJava
$env:FIN_BUDDY_KEY_PASSWORD=$taskPassword
try {
 if(!(Test-Path -LiteralPath $taskKey)) {
  & (Join-Path $taskJava 'bin/keytool.exe') -genkeypair -keystore $taskKey -storetype PKCS12 -alias finbuddy -keyalg RSA -keysize 3072 -validity 10000 -dname 'CN=Fin Buddy' -storepass:env FIN_BUDDY_KEY_PASSWORD -keypass:env FIN_BUDDY_KEY_PASSWORD
  if($LASTEXITCODE -ne 0){throw 'Could not create the local app signing key.'}
 }
 $taskOut=Join-Path $taskRoot 'output/apps'
 New-Item -ItemType Directory -Force -Path $taskOut | Out-Null
 $taskApk=Join-Path $taskOut 'Fin-Buddy-1.1.3-android.apk'
 $taskSigner=Join-Path $taskRoot '.build-tools/android-sdk/build-tools/36.0.0/apksigner.bat'
 & $taskSigner sign --ks $taskKey --ks-key-alias finbuddy --ks-pass env:FIN_BUDDY_KEY_PASSWORD --key-pass env:FIN_BUDDY_KEY_PASSWORD --out $taskApk (Join-Path $PSScriptRoot 'android/app/build/outputs/apk/release/app-release-unsigned.apk')
 if($LASTEXITCODE -ne 0){throw 'Android app signing failed.'}
 & $taskSigner verify --verbose --print-certs $taskApk
 if($LASTEXITCODE -ne 0){throw 'Signed APK verification failed.'}
 Get-FileHash -LiteralPath $taskApk -Algorithm SHA256 | Select-Object Hash
 Write-Output ('Verified installer: '+$taskApk)
} finally {Remove-Item Env:FIN_BUDDY_KEY_PASSWORD -ErrorAction SilentlyContinue}
