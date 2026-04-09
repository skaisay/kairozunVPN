#!/bin/bash
#
# KairozunVPN — Добавление нового клиента
# Запуск: sudo bash add-client.sh
#

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

# Проверка root
if [[ $EUID -ne 0 ]]; then
    echo -e "${RED}[ERROR]${NC} Запустите с правами root: sudo bash add-client.sh"
    exit 1
fi

# Проверка WireGuard
if [[ ! -f /etc/wireguard/wg0.conf ]]; then
    echo -e "${RED}[ERROR]${NC} WireGuard не настроен. Сначала запустите setup.sh"
    exit 1
fi

# Запрос имени клиента
read -rp "Имя клиента: " CLIENT_NAME
if [[ -z "$CLIENT_NAME" ]]; then
    echo -e "${RED}[ERROR]${NC} Имя клиента не может быть пустым"
    exit 1
fi

# Безопасная проверка имени
if [[ ! "$CLIENT_NAME" =~ ^[a-zA-Z0-9_-]+$ ]]; then
    echo -e "${RED}[ERROR]${NC} Имя клиента может содержать только буквы, цифры, - и _"
    exit 1
fi

CLIENT_DIR="/etc/wireguard/clients"
mkdir -p "$CLIENT_DIR"

if [[ -f "${CLIENT_DIR}/${CLIENT_NAME}.conf" ]]; then
    echo -e "${RED}[ERROR]${NC} Клиент с именем '${CLIENT_NAME}' уже существует"
    exit 1
fi

# Определяем параметры из серверного конфига
SERVER_PUBLIC_KEY=$(grep -A1 "\[Interface\]" /etc/wireguard/wg0.conf | grep "PrivateKey" | awk '{print $3}' | wg pubkey)
WG_PORT=$(grep "ListenPort" /etc/wireguard/wg0.conf | awk '{print $3}')
SERVER_ADDRESS=$(grep "Address" /etc/wireguard/wg0.conf | awk '{print $3}' | head -1)

# Определяем подсеть
WG_SUBNET=$(echo "$SERVER_ADDRESS" | grep -oP '\d+\.\d+\.\d+')
WG_SUBNET6="fd42:42:42"

# Определяем следующий свободный IP
LAST_IP=$(grep "AllowedIPs" /etc/wireguard/wg0.conf | grep -oP "${WG_SUBNET}\.\K\d+" | sort -n | tail -1)
NEXT_IP=$((LAST_IP + 1))

if [[ $NEXT_IP -gt 254 ]]; then
    echo -e "${RED}[ERROR]${NC} Достигнут лимит клиентов (253)"
    exit 1
fi

# Определяем внешний IP
SERVER_IP=$(curl -4 -s --max-time 5 https://api.ipify.org || curl -4 -s --max-time 5 https://ifconfig.me || echo "")
if [[ -z "$SERVER_IP" ]]; then
    read -rp "Введите внешний IP сервера: " SERVER_IP
fi

# DNS
WG_DNS="1.1.1.1, 1.0.0.1"
read -rp "DNS серверы [${WG_DNS}]: " input_dns
WG_DNS=${input_dns:-$WG_DNS}

# Генерация ключей
CLIENT_PRIVATE_KEY=$(wg genkey)
CLIENT_PUBLIC_KEY=$(echo "$CLIENT_PRIVATE_KEY" | wg pubkey)
CLIENT_PRESHARED_KEY=$(wg genpsk)

# Добавляем Peer в серверный конфиг
cat >> /etc/wireguard/wg0.conf << EOF

# ${CLIENT_NAME}
[Peer]
PublicKey = ${CLIENT_PUBLIC_KEY}
PresharedKey = ${CLIENT_PRESHARED_KEY}
AllowedIPs = ${WG_SUBNET}.${NEXT_IP}/32, ${WG_SUBNET6}::${NEXT_IP}/128
EOF

# Создаём клиентский конфиг
CLIENT_CONF="${CLIENT_DIR}/${CLIENT_NAME}.conf"
cat > "$CLIENT_CONF" << EOF
[Interface]
PrivateKey = ${CLIENT_PRIVATE_KEY}
Address = ${WG_SUBNET}.${NEXT_IP}/32, ${WG_SUBNET6}::${NEXT_IP}/128
DNS = ${WG_DNS}

[Peer]
PublicKey = ${SERVER_PUBLIC_KEY}
PresharedKey = ${CLIENT_PRESHARED_KEY}
Endpoint = ${SERVER_IP}:${WG_PORT}
AllowedIPs = 0.0.0.0/0, ::/0
PersistentKeepalive = 25
EOF

chmod 600 "$CLIENT_CONF"

# Перезагружаем WireGuard
wg syncconf wg0 <(wg-quick strip wg0)

echo ""
echo -e "${GREEN}Клиент '${CLIENT_NAME}' создан!${NC}"
echo -e "Конфигурация: ${CYAN}${CLIENT_CONF}${NC}"
echo -e "IP: ${CYAN}${WG_SUBNET}.${NEXT_IP}${NC}"
echo ""

# QR-код
if command -v qrencode &> /dev/null; then
    echo -e "${YELLOW}QR-код:${NC}"
    qrencode -t ANSIUTF8 < "$CLIENT_CONF"
fi
