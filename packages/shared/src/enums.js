"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TicketStatus = exports.UserRole = exports.SalesChannel = void 0;
var SalesChannel;
(function (SalesChannel) {
    SalesChannel["WEB"] = "WEB";
    SalesChannel["TAQUILLA"] = "TAQUILLA";
    SalesChannel["API"] = "API";
    SalesChannel["ADMIN"] = "ADMIN";
})(SalesChannel || (exports.SalesChannel = SalesChannel = {}));
var UserRole;
(function (UserRole) {
    UserRole["CUSTOMER"] = "CUSTOMER";
    UserRole["PROMOTER"] = "PROMOTER";
    UserRole["VENUE_MANAGER"] = "VENUE_MANAGER";
    UserRole["ADMIN"] = "ADMIN";
    UserRole["SUPER_ADMIN"] = "SUPER_ADMIN";
    UserRole["TAQUILLA"] = "TAQUILLA";
    UserRole["SCANNER"] = "SCANNER";
})(UserRole || (exports.UserRole = UserRole = {}));
var TicketStatus;
(function (TicketStatus) {
    TicketStatus["AVAILABLE"] = "AVAILABLE";
    TicketStatus["HELD"] = "HELD";
    TicketStatus["SOLD"] = "SOLD";
    TicketStatus["USED"] = "USED";
})(TicketStatus || (exports.TicketStatus = TicketStatus = {}));
//# sourceMappingURL=enums.js.map