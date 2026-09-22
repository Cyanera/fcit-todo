#!/bin/bash
# إدارة تشغيل البوت تلقائيًا في الخلفية عبر launchd (macOS).
#
# يولّد ملف الإعداد من مسارَي node والمشروع الفعليين وقت التثبيت، لأن node
# هنا من nvm ومساره يتغيّر مع كل ترقية — فالتثبيت يُعاد بعد أي ترقية.
#
#   npm run service:install    التثبيت والتشغيل مع الإقلاع
#   npm run service:status     الحالة
#   npm run service:logs       آخر السجل
#   npm run service:restart    إعادة التشغيل
#   npm run service:uninstall  الإلغاء

set -euo pipefail

LABEL="local.fcit-todo"
PROJECT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
DOMAIN="gui/$(id -u)"

die() { echo "❌ $1" >&2; exit 1; }

cmd_install() {
  local node_bin
  node_bin="$(command -v node)" || die "لم أجد node في PATH"
  [ -f "$PROJECT/.env" ] || die "ملف .env غير موجود في $PROJECT"

  # أي نسخة تعمل يدويًا ستتقاتل مع نسخة الخدمة على القفل
  pkill -TERM -f "node $PROJECT/src/index.js" 2>/dev/null || true
  pkill -TERM -f "node src/index.js" 2>/dev/null || true
  sleep 2

  cmd_uninstall_quiet

  mkdir -p "$HOME/Library/LaunchAgents" "$PROJECT/data"

  cat > "$PLIST" <<PLIST_EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>

  <key>ProgramArguments</key>
  <array>
    <string>$node_bin</string>
    <string>$PROJECT/src/index.js</string>
  </array>

  <key>WorkingDirectory</key><string>$PROJECT</string>

  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>$(dirname "$node_bin"):/usr/local/bin:/usr/bin:/bin</string>
  </dict>

  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <!-- يمنع إعادة التشغيل المتلاحقة لو فشل الإقلاع -->
  <key>ThrottleInterval</key><integer>30</integer>

  <!-- داخل المشروع لا في /tmp: السجل قد يحمل نصوص رسائلك -->
  <key>StandardOutPath</key><string>$PROJECT/data/run.log</string>
  <key>StandardErrorPath</key><string>$PROJECT/data/run.err</string>
</dict>
</plist>
PLIST_EOF

  launchctl bootstrap "$DOMAIN" "$PLIST" 2>/dev/null || launchctl load -w "$PLIST"
  sleep 3

  echo "✅ ثُبّتت الخدمة."
  echo "   node    : $node_bin"
  echo "   المشروع : $PROJECT"
  echo "   السجل   : $PROJECT/data/run.log"
  echo
  cmd_status
}

cmd_uninstall_quiet() {
  launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || launchctl unload "$PLIST" 2>/dev/null || true
  rm -f "$PLIST"
}

cmd_uninstall() {
  cmd_uninstall_quiet
  echo "✅ أُلغيت الخدمة. البوت لن يشتغل تلقائيًا بعد الآن."
}

cmd_status() {
  if [ ! -f "$PLIST" ]; then
    echo "الخدمة غير مثبّتة. للتثبيت: npm run service:install"
    return
  fi
  local pid
  pid="$(pgrep -f "node $PROJECT/src/index.js" | head -1 || true)"
  if [ -n "$pid" ]; then
    echo "✅ البوت يعمل (رقم العملية $pid)"
    echo "   اللوحة: http://localhost:$(grep -E '^PORT=' "$PROJECT/.env" 2>/dev/null | cut -d= -f2 || echo 3777)"
  else
    echo "⚠️  الخدمة مثبّتة لكن البوت لا يعمل — راجع: npm run service:logs"
  fi
}

cmd_logs() {
  echo "── آخر السجل ──"
  tail -n "${1:-30}" "$PROJECT/data/run.log" 2>/dev/null || echo "(لا سجل بعد)"
  if [ -s "$PROJECT/data/run.err" ]; then
    echo; echo "── الأخطاء ──"
    tail -n 15 "$PROJECT/data/run.err"
  fi
}

cmd_restart() {
  launchctl kickstart -k "$DOMAIN/$LABEL" 2>/dev/null || {
    cmd_uninstall_quiet
    cmd_install
    return
  }
  sleep 3
  echo "✅ أُعيد التشغيل."
  cmd_status
}

case "${1:-status}" in
  install)   cmd_install ;;
  uninstall) cmd_uninstall ;;
  status)    cmd_status ;;
  logs)      cmd_logs "${2:-30}" ;;
  restart)   cmd_restart ;;
  *) die "أمر غير معروف: $1 (install|uninstall|status|logs|restart)" ;;
esac
