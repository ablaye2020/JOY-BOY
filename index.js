// ========== ROUTE DE PAIRING POUR 𝐙𝐄𝐓𝐒𝐔-MD ==========
// AJOUTE CE CODE À LA FIN DE TON FICHIER PRINCIPAL, AVANT LE app.listen()

import express from 'express';
import { existsSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';

const app = express();
app.use(express.json());
app.use(express.static('public')); // Si tu veux une interface web

// Interface web optionnelle
app.get('/', (req, res) => {
    res.sendFile(join(process.cwd(), 'public', 'index.html'));
});

// Route API pour générer le code à 8 chiffres
app.post('/pair', async (req, res) => {
    const { numero } = req.body;

    if (!numero || !numero.match(/^[0-9]{10,15}$/)) {
        return res.status(400).json({ 
            error: "Numéro invalide. Exemple: 221783352603 (sans +, sans espace)" 
        });
    }

    const sessionDir = join(process.cwd(), 'sessions', `pair_${numero}`);

    try {
        // Nettoie ancienne session
        if (existsSync(sessionDir)) {
            rmSync(sessionDir, { recursive: true, force: true });
        }
        mkdirSync(sessionDir, { recursive: true });

        const { default: makeWASocket, useMultiFileAuthState, Browsers } = await import('@whiskeysockets/baileys');

        const { state, saveCreds } = await useMultiFileAuthState(sessionDir);

        const sock = makeWASocket({
            auth: state,
            browser: Browsers.macOS("Chrome"),
            printQRInTerminal: false,
            patchMessageBeforeSending: (message) => message,
            syncFullHistory: false
        });

        let pairingRequested = false;
        let responseSent = false;

        const pairingPromise = new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error("Délai dépassé (25s)"));
            }, 25000);

            sock.ev.on('connection.update', async (update) => {
                const { connection, lastDisconnect } = update;

                if (lastDisconnect?.error?.output?.statusCode === 405) {
                    clearTimeout(timeout);
                    reject(new Error("Numéro banni ou bloqué par WhatsApp"));
                    return;
                }

                if (connection === 'connecting' && !pairingRequested && !sock.authState.creds.registered) {
                    pairingRequested = true;
                    await new Promise(r => setTimeout(r, 1500));

                    try {
                        const code = await sock.requestPairingCode(numero);
                        const formattedCode = code?.match(/.{1,4}/g)?.join("-");
                        clearTimeout(timeout);
                        resolve({ code: formattedCode });
                    } catch (err) {
                        clearTimeout(timeout);
                        reject(err);
                    }
                }

                if (connection === 'open' && sock.authState.creds.registered) {
                    clearTimeout(timeout);
                    resolve({ alreadyConnected: true });
                }
            });

            sock.ev.on('creds.update', saveCreds);
        });

        const result = await pairingPromise;

        if (!responseSent) {
            responseSent = true;
            if (result.code) {
                res.json({
                    success: true,
                    code: result.code,
                    message: "Saisis ce code dans WhatsApp > Paramètres > Appareils liés"
                });
            } else if (result.alreadyConnected) {
                res.json({ success: true, message: "✅ Bot déjà connecté !" });
            }
        }

        // Nettoyage après 60 secondes
        setTimeout(() => {
            try {
                if (existsSync(sessionDir)) rmSync(sessionDir, { recursive: true, force: true });
            } catch (e) {}
        }, 60000);

    } catch (err) {
        console.error("❌ Erreur pairing:", err);
        if (!res.headersSent) {
            res.status(500).json({ error: err.message || "Erreur lors du pairing" });
        }
    }
});

// Lancement (si pas déjà fait ailleurs)
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🔥 𝐙𝐄𝐓𝐒𝐔-MD | Pairing API sur http://localhost:${PORT}`);
    console.log(`📱 Interface web : http://localhost:${PORT}`);
});
