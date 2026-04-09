#!/bin/bash
#
# KairozunVPN — Скрипт установки сервера WireGuard
# Запускайте на VPS с правами root: sudo bash setup.sh
#
# Поддерживаемые ОС: Ubuntu 20.04+, Debian 11+, CentOS 8+
#

set -euo pipefail

# === Цвета для вывода ===
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

print_header() {
    echo -e "${CYAN}"
    echo "  _  __     _                            __     ______  _   _ "
    echo " | |/ /    (_)                           \ \   / /  __ \| \ | |"
    echo " | ' / __ _ _ _ __ ___ _____   _ _ __     \ \ / /| |__) |  \| |"
    echo " |  < / _\` | | '__/ _ \_  / | | | '_ \     \ V / |  ___/| . \` |"
    echo " | . \ (_| | | | | (_) / /| |_| | | | |     | |  | |    | |\  |"
    echo " |_|\_\__,_|_|_|  \___/___|\__,_|_| |_|     |_|  |_|    |_| \_|"
    echo -e "${NC}"
    echo -e "${GREEN}Установка WireGuard VPN сервера${NC}"
    echo ""
}

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# === Проверки ===

check_root() {
    if [[ $EUID -ne 0 ]]; then
        log_error "Этот скрипт нужно запускать с правами root (sudo)"
        exit 1
    fi
}

detect_os() {
    if [[ -f /etc/os-release ]]; then
        . /etc/os-release
        OS=$ID
        OS_VERSION=$VERSION_ID
    else
        log_error "Невозможно определить ОС"
        exit 1
    fi
    log_info "Обнаружена ОС: $OS $OS_VERSION"
}

# === Установка WireGuard ===

install_wireguard() {
    log_info "Установка WireGuard..."

    case $OS in
        ubuntu|debian)
            apt-get update -qq
            apt-get install -y -qq wireguard wireguard-tools qrencode iptables
            ;;
        centos|rhel|rocky|almalinux)
            yum install -y epel-release
            yum install -y wireguard-tools qrencode iptables
            ;;
        fedora)
            dnf install -y wireguard-tools qrencode iptables
            ;;
        *)
            log_error "Неподдерживаемая ОС: $OS"
            exit 1
            ;;
    esac

    log_info "WireGuard установлен"
}

# === Настройка сети ===

setup_networking() {
    log_info "Настройка IP-форвардинга..."

    # Включаем IP forwarding
    echo "net.ipv4.ip_forward = 1" > /etc/sysctl.d/99-wireguard.conf
    echo "net.ipv6.conf.all.forwarding = 1" >> /etc/sysctl.d/99-wireguard.conf
    sysctl --system > /dev/null 2>&1

    log_info "IP-форвардинг включён"
}

# === Генерация ключей ===

generate_server_keys() {
    log_info "Генерация серверных ключей..."

    SERVER_PRIVATE_KEY=$(wg genkey)
    SERVER_PUBLIC_KEY=$(echo "$SERVER_PRIVATE_KEY" | wg pubkey)

    log_info "Серверные ключи сгенерированы"
}

# === Определение сетевого интерфейса ===

detect_network_interface() {
    NETWORK_INTERFACE=$(ip -4 route show default | awk '{print $5}' | head -1)
    if [[ -z "$NETWORK_INTERFACE" ]]; then
        log_error "Не удалось определить сетевой интерфейс"
        exit 1
    fi
    log_info "Сетевой интерфейс: $NETWORK_INTERFACE"
}

# === Определение внешнего IP ===

detect_public_ip() {
    SERVER_IP=$(curl -4 -s --max-time 5 https://api.ipify.org || \
                curl -4 -s --max-time 5 https://ifconfig.me || \
                curl -4 -s --max-time 5 https://icanhazip.com || \
                echo "")

    if [[ -z "$SERVER_IP" ]]; then
        log_warn "Не удалось определить внешний IP автоматически"
        read -rp "Введите внешний IP-адрес сервера: " SERVER_IP
    fi

    log_info "Внешний IP: $SERVER_IP"
}

# === Настройка параметров ===

setup_params() {
    # Порт WireGuard
    WG_PORT=51820
    read -rp "Порт WireGuard [${WG_PORT}]: " input_port
    WG_PORT=${input_port:-$WG_PORT}

    # Подсеть VPN
    WG_SUBNET="10.66.66"
    WG_SUBNET6="fd42:42:42"

    # DNS
    WG_DNS="1.1.1.1, 1.0.0.1"
    read -rp "DNS серверы [${WG_DNS}]: " input_dns
    WG_DNS=${input_dns:-$WG_DNS}

    # Количество клиентов
    CLIENT_COUNT=1
    read -rp "Сколько клиентских конфигураций создать [${CLIENT_COUNT}]: " input_count
    CLIENT_COUNT=${input_count:-$CLIENT_COUNT}
}

# === Создание серверной конфигурации ===

create_server_config() {
    log_info "Создание серверной конфигурации..."

    mkdir -p /etc/wireguard
    chmod 700 /etc/wireguard

    cat > /etc/wireguard/wg0.conf << EOF
[Interface]
Address = ${WG_SUBNET}.1/24, ${WG_SUBNET6}::1/64
ListenPort = ${WG_PORT}
PrivateKey = ${SERVER_PRIVATE_KEY}
PostUp = iptables -A FORWARD -i wg0 -j ACCEPT; iptables -t nat -A POSTROUTING -o ${NETWORK_INTERFACE} -j MASQUERADE; ip6tables -A FORWARD -i wg0 -j ACCEPT; ip6tables -t nat -A POSTROUTING -o ${NETWORK_INTERFACE} -j MASQUERADE
PostDown = iptables -D FORWARD -i wg0 -j ACCEPT; iptables -t nat -D POSTROUTING -o ${NETWORK_INTERFACE} -j MASQUERADE; ip6tables -D FORWARD -i wg0 -j ACCEPT; ip6tables -t nat -D POSTROUTING -o ${NETWORK_INTERFACE} -j MASQUERADE
EOF

    chmod 600 /etc/wireguard/wg0.conf
    log_info "Серверная конфигурация создана: /etc/wireguard/wg0.conf"
}

# === Создание клиентских конфигураций ===

create_client_configs() {
    CLIENT_DIR="/etc/wireguard/clients"
    mkdir -p "$CLIENT_DIR"

    for i in $(seq 1 "$CLIENT_COUNT"); do
        CLIENT_NAME="kairozun-client-${i}"
        CLIENT_IP_NUM=$((i + 1))

        log_info "Создание клиента: ${CLIENT_NAME}..."

        # Генерация ключей клиента
        CLIENT_PRIVATE_KEY=$(wg genkey)
        CLIENT_PUBLIC_KEY=$(echo "$CLIENT_PRIVATE_KEY" | wg pubkey)
        CLIENT_PRESHARED_KEY=$(wg genpsk)

        # Добавляем Peer в серверный конфиг
        cat >> /etc/wireguard/wg0.conf << EOF

# ${CLIENT_NAME}
[Peer]
PublicKey = ${CLIENT_PUBLIC_KEY}
PresharedKey = ${CLIENT_PRESHARED_KEY}
AllowedIPs = ${WG_SUBNET}.${CLIENT_IP_NUM}/32, ${WG_SUBNET6}::${CLIENT_IP_NUM}/128
EOF

        # Создаём клиентский конфиг
        CLIENT_CONF="${CLIENT_DIR}/${CLIENT_NAME}.conf"
        cat > "$CLIENT_CONF" << EOF
[Interface]
PrivateKey = ${CLIENT_PRIVATE_KEY}
Address = ${WG_SUBNET}.${CLIENT_IP_NUM}/32, ${WG_SUBNET6}::${CLIENT_IP_NUM}/128
DNS = ${WG_DNS}

[Peer]
PublicKey = ${SERVER_PUBLIC_KEY}
PresharedKey = ${CLIENT_PRESHARED_KEY}
Endpoint = ${SERVER_IP}:${WG_PORT}
AllowedIPs = 0.0.0.0/0, ::/0
PersistentKeepalive = 25
EOF

        chmod 600 "$CLIENT_CONF"

        echo ""
        echo -e "${GREEN}=== Конфигурация: ${CLIENT_NAME} ===${NC}"
        echo -e "${CYAN}Файл: ${CLIENT_CONF}${NC}"
        echo ""

        # Генерируем QR-код если доступен qrencode
        if command -v qrencode &> /dev/null; then
            QR_FILE="${CLIENT_DIR}/${CLIENT_NAME}-qr.png"
            qrencode -t PNG -o "$QR_FILE" < "$CLIENT_CONF"
            log_info "QR-код: ${QR_FILE}"

            echo -e "${YELLOW}QR-код для мобильного приложения:${NC}"
            qrencode -t ANSIUTF8 < "$CLIENT_CONF"
        fi

        echo ""
    done
}

# === Запуск WireGuard ===

start_wireguard() {
    log_info "Запуск WireGuard..."

    systemctl enable wg-quick@wg0
    systemctl start wg-quick@wg0

    log_info "WireGuard запущен и добавлен в автозагрузку"
}

# === Настройка файрвола ===

setup_firewall() {
    log_info "Настройка файрвола..."

    # UFW
    if command -v ufw &> /dev/null; then
        ufw allow "${WG_PORT}/udp" > /dev/null 2>&1
        log_info "UFW: порт ${WG_PORT}/udp открыт"
    fi

    # firewalld
    if command -v firewall-cmd &> /dev/null; then
        firewall-cmd --permanent --add-port="${WG_PORT}/udp" > /dev/null 2>&1
        firewall-cmd --reload > /dev/null 2>&1
        log_info "firewalld: порт ${WG_PORT}/udp открыт"
    fi
}

# === Вывод итогов ===

print_summary() {
    echo ""
    echo -e "${GREEN}============================================${NC}"
    echo -e "${GREEN}  KairozunVPN сервер успешно установлен!${NC}"
    echo -e "${GREEN}============================================${NC}"
    echo ""
    echo -e "  Сервер:     ${CYAN}${SERVER_IP}:${WG_PORT}${NC}"
    echo -e "  Интерфейс:  ${CYAN}wg0${NC}"
    echo -e "  Подсеть:    ${CYAN}${WG_SUBNET}.0/24${NC}"
    echo ""
    echo -e "  Публичный ключ сервера:"
    echo -e "  ${YELLOW}${SERVER_PUBLIC_KEY}${NC}"
    echo ""
    echo -e "  Конфигурации клиентов: ${CYAN}/etc/wireguard/clients/${NC}"
    echo ""
    echo -e "  ${GREEN}Скопируйте .conf файлы клиентам и импортируйте${NC}"
    echo -e "  ${GREEN}их в приложение KairozunVPN${NC}"
    echo ""
    echo -e "  Управление:"
    echo -e "    Статус:      ${CYAN}sudo wg show${NC}"
    echo -e "    Перезапуск:  ${CYAN}sudo systemctl restart wg-quick@wg0${NC}"
    echo -e "    Остановка:   ${CYAN}sudo systemctl stop wg-quick@wg0${NC}"
    echo ""
    echo -e "  Добавить клиента: ${CYAN}sudo bash add-client.sh${NC}"
    echo ""
}

# === Основной поток ===

main() {
    print_header
    check_root
    detect_os
    install_wireguard
    setup_networking
    generate_server_keys
    detect_network_interface
    detect_public_ip
    setup_params
    create_server_config
    create_client_configs
    setup_firewall
    start_wireguard
    print_summary
}

main
