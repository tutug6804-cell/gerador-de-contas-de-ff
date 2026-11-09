#!/usr/bin/env node
'use strict';
// Gerador de Contas FF - Instalador VPS (100% Node.js, sem shell).
// Uso:  sudo node instalar.js [--bot-config=/caminho/do/config.json]
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const C = { green: '\x1b[92m', red: '\x1b[31m', yellow: '\x1b[93m', cyan: '\x1b[38;5;87m', bold: '\x1b[1m', nc: '\x1b[0m' };
const ok = (m) => console.log(`  ${C.green}[OK]${C.nc} ${m}`);
const info = (m) => console.log(`  ${C.yellow}[INFO]${C.nc} ${m}`);
const erro = (m) => { console.error(`  ${C.red}[ERRO]${C.nc} ${m}`); process.exit(1); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const run = (cmd, args = [], opts = {}) => {
    const r = spawnSync(cmd, args, { encoding: 'utf8', stdio: opts.inherit ? 'inherit' : 'pipe', cwd: opts.cwd });
    return { code: r.status === null ? 1 : r.status, out: (r.stdout || '').trim() };
};

const SCRIPT_DIR = __dirname;
const TARGET_DIR = '/root/gerador_api';
const SERVICO = 'gerador-ff';
const PORTA = 3000;

function copiarArquivos() {
    fs.mkdirSync(TARGET_DIR, { recursive: true });
    if (path.resolve(SCRIPT_DIR) === TARGET_DIR) return info(`Ja esta em ${TARGET_DIR}, pulando copia.`);
    for (const f of ['server.js', 'package.json', 'package-lock.json']) {
        const origem = path.join(SCRIPT_DIR, f);
        if (fs.existsSync(origem)) fs.copyFileSync(origem, path.join(TARGET_DIR, f));
        else if (f !== 'package-lock.json') erro(`Arquivo nao encontrado: ${origem}`);
    }
}

function integrarComBot(configArg) {
    const candidatos = [
        configArg,
        '/root/salasff/config.json',
        '/root/salasjspost/config.json',
        path.join(SCRIPT_DIR, '..', 'salasff', 'config.json'),
        '/root/FF_SALAS_BOT/salasff/config.json',
    ].filter(Boolean);

    const arquivo = candidatos.find((p) => fs.existsSync(p));
    if (!arquivo) {
        info("Nao encontrei o config.json do bot de salas. Ajuste la manualmente:");
        console.log(`    ${C.cyan}"gerador_api_url": "http://127.0.0.1:${PORTA}"${C.nc}`);
        return;
    }
    info(`Configuracao do bot: ${arquivo}`);
    try {
        const cfg = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
        fs.copyFileSync(arquivo, arquivo + '.bak');
        cfg.gerador_api_url = `http://127.0.0.1:${PORTA}`;
        fs.writeFileSync(arquivo, JSON.stringify(cfg, null, 2));
        ok('config.json atualizado!');
        run('systemctl', ['restart', 'salaff']);
        run('systemctl', ['restart', 'salaff-go']);
        ok('Servicos salaff e salaff-go reiniciados (se existirem)');
    } catch (e) {
        info(`Nao consegui editar o config.json (${e.message}). Ajuste manualmente.`);
    }
}

(async () => {
    console.log(`\n  ${C.cyan}${C.bold}Gerador de Contas FF - Instalador VPS (Node.js)${C.nc}\n`);
    if (typeof process.getuid === 'function' && process.getuid() !== 0) erro('Execute como root: sudo node instalar.js');
    if (parseInt(process.versions.node, 10) < 18) erro(`Node.js >= 18 e necessario (atual: ${process.version})`);
    ok(`Node.js ${process.version}`);

    info(`Configurando ${TARGET_DIR}...`);
    copiarArquivos();
    ok('Arquivos configurados');

    info('Instalando dependencias...');
    if (run('npm', ['install', '--production'], { cwd: TARGET_DIR, inherit: true }).code !== 0) erro('npm install falhou');
    ok('Dependencias instaladas');

    info(`Criando servico systemd (${SERVICO}.service)...`);
    fs.writeFileSync(`/etc/systemd/system/${SERVICO}.service`, `[Unit]
Description=Gerador de Contas FF - API
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=${TARGET_DIR}
ExecStart=${process.execPath} ${TARGET_DIR}/server.js
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
Environment=PORT=${PORTA}
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
`);
    run('systemctl', ['daemon-reload']);
    run('systemctl', ['enable', SERVICO]);
    run('systemctl', ['restart', SERVICO]);
    await sleep(2000);
    if (run('systemctl', ['is-active', SERVICO]).out !== 'active') erro(`O servico falhou. Veja: journalctl -u ${SERVICO} -n 20`);
    ok(`Servico ${SERVICO} ativo`);

    if (run('which', ['ufw']).code === 0) { run('ufw', ['allow', `${PORTA}/tcp`]); ok(`Porta ${PORTA} liberada no UFW`); }

    const arg = process.argv.find((a) => a.startsWith('--bot-config='));
    integrarComBot(arg ? arg.split('=')[1] : null);

    let health = 'ERROR';
    try { health = await (await fetch(`http://127.0.0.1:${PORTA}/health`)).text(); } catch (e) { /* sem resposta */ }
    console.log(`\n  Status: ${C.green}● RODANDO${C.nc} (porta ${PORTA})`);
    console.log(health === 'ERROR' ? `  /health: ${C.red}FALHA${C.nc}` : `  /health: ${C.green}${health}${C.nc}`);
    console.log(`\n  Logs:      journalctl -u ${SERVICO} -f\n  Reiniciar: systemctl restart ${SERVICO}\n  Parar:     systemctl stop ${SERVICO}\n`);
})();
