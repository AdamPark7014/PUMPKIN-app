"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateTicketCode = generateTicketCode;
exports.signTicketPayload = signTicketPayload;
exports.verifyTicketSignature = verifyTicketSignature;
exports.buildQrPayload = buildQrPayload;
const crypto_1 = require("crypto");
const ROTATION_SECONDS = 15;
function generateTicketCode() {
    return `BLT-${(0, crypto_1.randomBytes)(8).toString('hex').toUpperCase()}`;
}
function signTicketPayload(ticketId, eventId, secret) {
    const payload = `${ticketId}:${eventId}:${Math.floor(Date.now() / (ROTATION_SECONDS * 1000))}`;
    return (0, crypto_1.createHmac)('sha256', secret).update(payload).digest('hex').slice(0, 32);
}
function verifyTicketSignature(ticketId, eventId, signature, secret) {
    const current = signTicketPayload(ticketId, eventId, secret);
    const prevWindow = Math.floor(Date.now() / (ROTATION_SECONDS * 1000)) - 1;
    const prevPayload = `${ticketId}:${eventId}:${prevWindow}`;
    const prev = (0, crypto_1.createHmac)('sha256', secret).update(prevPayload).digest('hex').slice(0, 32);
    return signature === current || signature === prev;
}
function buildQrPayload(ticketId, eventId, secret) {
    const sig = signTicketPayload(ticketId, eventId, secret);
    return JSON.stringify({ t: ticketId, e: eventId, s: sig });
}
//# sourceMappingURL=index.js.map