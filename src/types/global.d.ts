interface Window {
  fbq: (
    command: 'track' | 'trackCustom' | 'init' | 'pageView',
    eventNameOrPixelId: string,
    params?: Record<string, any>
  ) => void;
  PortOne?: {
    requestPayment: (params: unknown) => Promise<{
      code?: string
      message?: string
      paymentId?: string
    }>
    requestIssueBillingKey: (params: Record<string, unknown>) => Promise<{
      billingKey?: string
      code?: string
      message?: string
    }>
    requestIdentityVerification: (params: Record<string, unknown>) => Promise<{
      transactionType?: string
      identityVerificationId?: string
      identityVerificationTxId?: string
      code?: string
      message?: string
      pgCode?: string
      pgMessage?: string
    }>
  }
}
