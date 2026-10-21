param(
  [string]$Message
)
$ErrorActionPreference='Stop'
$taskRepoRoot=Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $taskRepoRoot

$taskStatus=git status --porcelain
if(!$taskStatus){Write-Host 'Nothing to commit; working tree is clean.'; exit 0}

Write-Host 'Changes to be pushed:'
git status --short

git add -A

# This repo is PUBLIC on GitHub. Before committing anything, scan the actual staged
# content for secret-SHAPED strings, not variable names (a bare "DATABASE_URL=" keyword
# check is too easy to false-positive on code that just looks for that name, e.g. this
# script's own .env parser) and not just filenames.
$taskSecretPatterns=@(
  'postgresql://[^\s"'']+:[^\s"'']+@',               # a live connection string always embeds credentials
  '-----BEGIN [A-Z ]*PRIVATE KEY-----',               # PEM private key
  '(?im)^\+.*[^A-Za-z0-9_-]([A-Za-z0-9_-]{43})(?![A-Za-z0-9_-])'  # a bare 43-char base64url device token (this project's exact reader-token format)
)
$taskDiff=git diff --cached
$taskHit=$null
foreach($taskPattern in $taskSecretPatterns){
  $taskMatch=$taskDiff | Select-String -Pattern $taskPattern
  if($taskMatch){$taskHit=$taskMatch; break}
}
if($taskHit){
  git reset | Out-Null
  Write-Host $taskHit
  throw 'Refusing to commit: the staged diff looks like it contains a real secret/credential (see the matched line above). Nothing was committed or pushed. Review the file, keep real secrets out of git (.env, ReaderConfigs, Backups already are), then rerun.'
}

if(!$Message){$Message='Update '+(Get-Date -Format 'yyyy-MM-dd HH:mm')}
git commit -m $Message
if($LASTEXITCODE -ne 0){throw 'git commit failed.'}

$taskBranch=git rev-parse --abbrev-ref HEAD
$taskUpstream=git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>$null
if($taskUpstream){git push}else{git push -u origin $taskBranch}
if($LASTEXITCODE -ne 0){throw 'git push failed. Check your GitHub credentials/network, then push manually once fixed (your commit is already saved locally).'}
Write-Host "Pushed branch '$taskBranch' to GitHub."
