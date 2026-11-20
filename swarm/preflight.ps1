# SWRMsync preflight: is each AI installed and signed in? Prints one line per AI:
#   READY <name>
#   SKIP  <name> <what to do>
# SWRMsync starts only the READY ones, so an AI that would stop at a sign-in screen is never launched.
$ErrorActionPreference = 'SilentlyContinue'

function Has($cmd) { [bool](Get-Command $cmd -ErrorAction SilentlyContinue) }

# Claude Code: installed, and signed in (saved login) or an API key.
if (-not (Has 'claude')) { 'SKIP claude Claude Code is not installed: npm install -g @anthropic-ai/claude-code' }
elseif ((Test-Path "$env:USERPROFILE\.claude\.credentials.json") -or $env:ANTHROPIC_API_KEY) { 'READY claude' }
else { 'SKIP claude Not signed in: open a terminal, run claude, and sign in.' }

# Codex (ChatGPT): its own status command.
if (-not (Has 'codex')) { 'SKIP codex Codex is not installed: npm install -g @openai/codex' }
else {
  $s = (cmd /c "codex login status 2>&1" | Out-String) # Codex prints this on its error stream
  if ($s -match 'Logged in') { 'READY codex' }
  else { 'SKIP codex Not signed in: open a terminal, run codex login.' }
}

# Gemini CLI: a chosen sign-in method in its settings, or a key.
if (-not (Has 'gemini')) { 'SKIP gemini Gemini CLI is not installed: npm install -g @google/gemini-cli' }
else {
  $auth = $null
  $settings = "$env:USERPROFILE\.gemini\settings.json"
  if (Test-Path $settings) {
    try { $j = Get-Content $settings -Raw | ConvertFrom-Json; $auth = $j.security.auth.selectedType; if (-not $auth) { $auth = $j.selectedAuthType } } catch {}
  }
  if ($auth -or $env:GEMINI_API_KEY -or $env:GOOGLE_GENAI_USE_VERTEXAI) { 'READY gemini' }
  else { 'SKIP gemini Not signed in: open a terminal, run gemini, choose Login with Google.' }
}
