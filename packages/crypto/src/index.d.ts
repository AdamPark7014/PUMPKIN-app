export declare function generateTicketCode(): string;
export declare function signTicketPayload(ticketId: string, eventId: string, secret: string): string;
export declare function verifyTicketSignature(ticketId: string, eventId: string, signature: string, secret: string): boolean;
export declare function buildQrPayload(ticketId: string, eventId: string, secret: string): string;
//# sourceMappingURL=index.d.ts.map