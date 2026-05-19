export const SYSTEM_SETTINGS_KEY = 'arrimo_orthoscan_system_settings_v1'
export const SYSTEM_SETTINGS_CHANGED_EVENT = 'arrimo:system-settings-changed'

export type AppThemeMode = 'light' | 'dark'

export type LabCompanyProfile = {
  tradeName: string
  legalName: string
  cnpj: string
  email: string
  phone: string
  whatsapp: string
  website?: string
  addressLine: string
  logoDataUrl?: string
  updatedAt?: string
}

export type SystemAuditEntry = {
  id: string
  createdAt: string
  action: string
  actor?: string
  details?: string
}

export type PricingMode = 'unit' | 'arch' | 'tooth'
export type PricingArchScope = 'ambas' | 'superior' | 'inferior'

export type ProductPricingItem = {
  id: string
  name: string
  productType?: string
  pricingMode: PricingMode
  archScope?: PricingArchScope
  unitPrice?: number
  upperPrice?: number
  lowerPrice?: number
  toothUnitPrice?: number
  selectedTeeth?: string[]
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export type SystemSettings = {
  theme: AppThemeMode
  labCompany: LabCompanyProfile
  guideAutomation: {
    enabled: boolean
    leadDays: number
  }
  whatsappService: {
    enabled: boolean
    baseUrl: string
    adminToken: string
  }
  aiGateway: {
    enabled: boolean
    modules: {
      clinica: boolean
      lab: boolean
      gestao: boolean
      comercial: boolean
    }
    provider: 'mock' | 'http' | 'openai'
    model: string
    apiBaseUrl: string
    apiKey: string
  }
  priceCatalog: ProductPricingItem[]
  audit: SystemAuditEntry[]
}

const emptyLabCompany: LabCompanyProfile = {
  tradeName: '',
  legalName: '',
  cnpj: '',
  email: '',
  phone: '',
  whatsapp: '',
  website: '',
  addressLine: '',
  logoDataUrl: undefined,
  updatedAt: undefined,
}

const defaultSettings: SystemSettings = {
  theme: 'light',
  labCompany: emptyLabCompany,
  guideAutomation: {
    enabled: true,
    leadDays: 10,
  },
  whatsappService: {
    enabled: false,
    baseUrl: '',
    adminToken: '',
  },
  aiGateway: {
    enabled: false,
    modules: {
      clinica: false,
      lab: false,
      gestao: false,
      comercial: false,
    },
    provider: 'mock',
    model: 'gpt-4.1-mini',
    apiBaseUrl: '',
    apiKey: '',
  },
  priceCatalog: [],
  audit: [],
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object'
}

export function loadSystemSettings(): SystemSettings {
  const raw = localStorage.getItem(SYSTEM_SETTINGS_KEY)
  if (!raw) return defaultSettings

  try {
    const parsed = JSON.parse(raw) as unknown
    if (!isObject(parsed)) return defaultSettings

    const theme = parsed.theme === 'dark' ? 'dark' : 'light'
    const companyRaw = isObject(parsed.labCompany) ? parsed.labCompany : {}
    const guideAutomationRaw = isObject(parsed.guideAutomation) ? parsed.guideAutomation : {}
    const whatsappServiceRaw = isObject(parsed.whatsappService) ? parsed.whatsappService : {}
    const aiGatewayRaw = isObject(parsed.aiGateway) ? parsed.aiGateway : {}
    const aiModulesRaw = isObject(aiGatewayRaw.modules) ? aiGatewayRaw.modules : {}

    const labCompany: LabCompanyProfile = {
      tradeName: String(companyRaw.tradeName ?? ''),
      legalName: String(companyRaw.legalName ?? ''),
      cnpj: String(companyRaw.cnpj ?? ''),
      email: String(companyRaw.email ?? ''),
      phone: String(companyRaw.phone ?? ''),
      whatsapp: String(companyRaw.whatsapp ?? ''),
      website: String(companyRaw.website ?? ''),
      addressLine: String(companyRaw.addressLine ?? ''),
      logoDataUrl: typeof companyRaw.logoDataUrl === 'string' ? companyRaw.logoDataUrl : undefined,
      updatedAt: typeof companyRaw.updatedAt === 'string' ? companyRaw.updatedAt : undefined,
    }
    const guideAutomation = {
      enabled: guideAutomationRaw.enabled !== false,
      leadDays:
        typeof guideAutomationRaw.leadDays === 'number' && Number.isFinite(guideAutomationRaw.leadDays)
          ? Math.max(0, Math.trunc(guideAutomationRaw.leadDays))
          : 10,
    }
    const whatsappService = {
      enabled: whatsappServiceRaw.enabled === true,
      baseUrl: typeof whatsappServiceRaw.baseUrl === 'string' ? whatsappServiceRaw.baseUrl : '',
      adminToken: typeof whatsappServiceRaw.adminToken === 'string' ? whatsappServiceRaw.adminToken : '',
    }
    const aiGateway = {
      enabled: aiGatewayRaw.enabled === true,
      modules: {
        clinica: aiModulesRaw.clinica === true,
        lab: aiModulesRaw.lab === true,
        gestao: aiModulesRaw.gestao === true,
        comercial: aiModulesRaw.comercial === true,
      },
      provider: aiGatewayRaw.provider === 'http' || aiGatewayRaw.provider === 'openai' ? aiGatewayRaw.provider : 'mock',
      model: typeof aiGatewayRaw.model === 'string' && aiGatewayRaw.model.trim() ? aiGatewayRaw.model : 'gpt-4.1-mini',
      apiBaseUrl: typeof aiGatewayRaw.apiBaseUrl === 'string' ? aiGatewayRaw.apiBaseUrl : '',
      apiKey: typeof aiGatewayRaw.apiKey === 'string' ? aiGatewayRaw.apiKey : '',
    } as SystemSettings['aiGateway']

    const auditRaw = Array.isArray(parsed.audit) ? parsed.audit : []
    const catalogRaw = Array.isArray(parsed.priceCatalog) ? parsed.priceCatalog : []
    const priceCatalog: ProductPricingItem[] = catalogRaw
      .filter(isObject)
      .map((item) => ({
        id: String(item.id ?? `price_${Date.now()}`),
        name: String(item.name ?? ''),
        productType: typeof item.productType === 'string' ? item.productType : undefined,
        pricingMode: item.pricingMode === 'arch' || item.pricingMode === 'tooth' ? item.pricingMode : 'unit',
        archScope: item.archScope === 'superior' || item.archScope === 'inferior' ? item.archScope : 'ambas',
        unitPrice: typeof item.unitPrice === 'number' ? item.unitPrice : undefined,
        upperPrice: typeof item.upperPrice === 'number' ? item.upperPrice : undefined,
        lowerPrice: typeof item.lowerPrice === 'number' ? item.lowerPrice : undefined,
        toothUnitPrice: typeof item.toothUnitPrice === 'number' ? item.toothUnitPrice : undefined,
        selectedTeeth: Array.isArray(item.selectedTeeth) ? item.selectedTeeth.map((tooth) => String(tooth)) : undefined,
        isActive: item.isActive !== false,
        createdAt: String(item.createdAt ?? new Date().toISOString()),
        updatedAt: String(item.updatedAt ?? new Date().toISOString()),
      }))
    const audit: SystemAuditEntry[] = auditRaw
      .filter(isObject)
      .map((item) => ({
        id: String(item.id ?? `audit_${Date.now()}`),
        createdAt: String(item.createdAt ?? new Date().toISOString()),
        action: String(item.action ?? 'unknown'),
        actor: typeof item.actor === 'string' ? item.actor : undefined,
        details: typeof item.details === 'string' ? item.details : undefined,
      }))

    return {
      theme,
      labCompany,
      guideAutomation,
      whatsappService,
      aiGateway,
      priceCatalog,
      audit,
    }
  } catch {
    return defaultSettings
  }
}

export function saveSystemSettings(settings: SystemSettings) {
  localStorage.setItem(SYSTEM_SETTINGS_KEY, JSON.stringify(settings))
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(SYSTEM_SETTINGS_CHANGED_EVENT))
  }
}

export function applyTheme(theme: AppThemeMode) {
  document.documentElement.setAttribute('data-theme', theme)
}

export function applyStoredTheme() {
  const settings = loadSystemSettings()
  applyTheme(settings.theme)
}

export function addAuditEntry(
  settings: SystemSettings,
  payload: { action: string; actor?: string; details?: string },
): SystemSettings {
  const entry: SystemAuditEntry = {
    id: `audit_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    createdAt: new Date().toISOString(),
    action: payload.action,
    actor: payload.actor,
    details: payload.details,
  }

  return {
    ...settings,
    audit: [entry, ...settings.audit].slice(0, 200),
  }
}
