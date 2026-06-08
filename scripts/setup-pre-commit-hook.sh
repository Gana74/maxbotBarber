#!/bin/sh
# Устанавливает pre-commit hook: блокирует коммит sensitive файлов.
# Запуск: sh scripts/setup-pre-commit-hook.sh

HOOK_PATH=".git/hooks/pre-commit"

cat > "$HOOK_PATH" << 'EOF'
#!/bin/sh
BLOCKED_PATTERNS='\.env|\.env\.local|\.env\.production|credentials\.json|sessions\.json|banned\.json|^logs/|^backups/'

STAGED=$(git diff --cached --name-only)
for file in $STAGED; do
  if echo "$file" | grep -Eq "$BLOCKED_PATTERNS"; then
    echo "ERROR: Attempt to commit sensitive file: $file"
    echo "Remove it from staging: git reset HEAD -- $file"
    exit 1
  fi
done
exit 0
EOF

chmod +x "$HOOK_PATH"
echo "Pre-commit hook installed at $HOOK_PATH"
