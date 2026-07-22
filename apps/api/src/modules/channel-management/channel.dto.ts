export type ChannelConfigDto = {
  web?: { enabled: boolean; allocation: number; discount?: number; activeHours?: string };
  taquilla?: { enabled: boolean; allocation: number; locations: string[] };
  api?: { enabled: boolean; allocation: number; partners: string[] };
  phone?: { enabled: boolean; allocation: number; hours?: string };
};

export type ApiPartnerDto = {
  name: string;
  apiKey: string;
  allocation?: number;
  commissionRate?: number;
  rateLimit?: number;
};

export type TaquillaLocationDto = {
  name: string;
  address: string;
  city: string;
  terminals: number;
  staff: string[];
  activeHours?: string;
};
