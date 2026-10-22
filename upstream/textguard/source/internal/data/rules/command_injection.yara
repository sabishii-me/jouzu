// Modified: command names alone produce advisory findings.
rule command_injection {
  meta:
    description = "M1 baseline rule"
    severity = "warn"
  strings:
    $a = /\b(curl|wget|bash\s+-c|powershell)\b/i
  condition:
    $a
}
