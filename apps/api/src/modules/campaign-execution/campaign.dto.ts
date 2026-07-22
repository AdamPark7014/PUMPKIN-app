export type CreateCampaignDto = {
  name: string;
  type: string;
  startsAt: Date;
  endsAt: Date;
  allocation: number;
  quantityPerUser: number;
  discountType: 'percentage' | 'fixed';
  discountValue: number;
};

export type ApplyDiscountDto = {
  basePrice: number;
  quantity: number;
};
