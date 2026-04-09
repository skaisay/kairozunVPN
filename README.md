# KairozunVPN

Бесплатный VPN-клиент с красивым интерфейсом на базе протокола WireGuard.

---

## Возможности

- Подключение через протокол WireGuard (быстрый, современный, безопасный)
- Импорт конфигураций `.conf`
- Генератор ключей WireGuard
- Отображение трафика в реальном времени
- Kill Switch (блокировка интернета при разрыве VPN)
- Управление несколькими серверами
- Сворачивание в системный трей
- Стеклянный (glassmorphism) дизайн

---

## Быстрый старт

### 1. Установка клиента

```bash
git clone https://github.com/YOUR_USERNAME/kairozunVPn.git
cd kairozunVPn
npm install
npm start
```

### 2. Установка WireGuard

Клиент использует WireGuard для VPN-туннелирования. Скачайте и установите:

- **Windows**: https://www.wireguard.com/install/
- **Linux**: `sudo apt install wireguard` (Ubuntu/Debian) или `sudo dnf install wireguard-tools` (Fedora)
- **macOS**: `brew install wireguard-tools`

### 3. Настройка сервера

Для работы VPN нужен сервер (VPS). Рекомендуемые провайдеры:
- [Hetzner](https://www.hetzner.com/) (Германия/Финляндия, от 3.29 EUR/мес)
- [DigitalOcean](https://www.digitalocean.com/) (множество локаций, от $4/мес)
- [Vultr](https://www.vultr.com/) (множество локаций, от $3.50/мес)
- [Oracle Cloud](https://www.oracle.com/cloud/free/) (бесплатный тариф)

После покупки VPS, подключитесь по SSH и запустите:

```bash
# Скачиваем и запускаем скрипт установки
wget https://raw.githubusercontent.com/YOUR_USERNAME/kairozunVPn/main/server/setup.sh
sudo bash setup.sh
```

Скрипт автоматически:
- Установит WireGuard
- Настроит серверную конфигурацию
- Сгенерирует клиентские ключи и конфигурации
- Покажет QR-код для мобильного приложения
- Откроет нужные порты в файрволе

### 4. Импорт конфигурации в клиент

1. Скопируйте файл `.conf` с сервера на свой компьютер
2. В приложении KairozunVPN нажмите кнопку импорта (стрелка вниз)
3. Выберите файл `.conf`
4. Нажмите "Подключиться"

---

## Добавление новых клиентов

На сервере:

```bash
sudo bash add-client.sh
```

Введите имя нового клиента. Скрипт создаст конфигурацию и покажет QR-код.

---

## Структура проекта

```
kairozunVPn/
  main.js              — Electron main process
  preload.js           — IPC bridge (context isolation)
  renderer/
    index.html         — Интерфейс приложения
    styles.css         — Glassmorphism стили
    app.js             — Логика UI
  src/
    vpn-manager.js     — Управление WireGuard
  server/
    setup.sh           — Установка сервера WireGuard
    add-client.sh      — Добавление клиентов
  assets/
    icon.svg           — Иконка приложения
```

---

## Сборка

```bash
# Windows (.exe установщик)
npm run build

# Linux (.AppImage, .deb)
npm run build:linux

# macOS (.dmg)
npm run build:mac
```

---

## Безопасность

- Весь трафик шифруется протоколом WireGuard (ChaCha20, Curve25519, BLAKE2s)
- Приватные ключи хранятся локально с ограниченными правами доступа
- Context Isolation и Sandbox включены в Electron
- Content Security Policy настроен в HTML
- Никакие данные не отправляются третьим лицам

---

## Требования

- Node.js 18+
- WireGuard (установленный в системе)
- Для Windows: запуск от имени администратора (для управления туннелями)
- Для Linux/macOS: sudo (для wg-quick)

---

## Лицензия

MIT
