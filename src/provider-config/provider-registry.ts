import { z } from "zod";
import { ProviderConfig } from "./types";
import { BaseProvider } from "./base-provider";
import { DummyProvider } from "./dummy.provider";
import { SabioPayProvider } from "./sabiopay.provider";
import { EaseMyNeedsProvider } from "./easemyneeds.provider";
import { TpipayProvider } from "./tpipay.provider";
import { PayprimeProvider } from "./payprime.provider";
import { PaysixProvider } from "./paysix.provider";

type CredentialKeyMap = Record<string, string>;

export const KEY_ALIASES: CredentialKeyMap = {
  apikey: "apiKey",
  apisecret: "apiSecret",
  apisalt: "apiSalt",
  baseurl: "baseUrl",
  token: "apiToken",
  merchantid: "merchantId",
  clientid: "clientId",
  accesscode: "accessCode",
  workingkey: "workingKey",
  secretkey: "secretKey",
  apitoken: "apiToken",
  paytype: "payType",
};

export type ProviderCredentialsSchema = z.ZodObject<Record<string, z.ZodTypeAny>>;

export type ProviderRegistration<TCreds extends Record<string, string>> = {
  credentialsSchema: ProviderCredentialsSchema;
  create: (config: ProviderConfig & { credentials: TCreds }) => BaseProvider;
  allowEmptyCredentials?: boolean;
};

const DummyCredentialsSchema = z.object({}).strict();
const SabioPayCredentialsSchema = z
  .object({
    apiKey: z.string().min(1),
    apiSalt: z.string().min(1),
    baseUrl: z.string().url().optional(),
  })
  .strict();

const EaseMyNeedsCredentialsSchema = z
  .object({
    apiKey: z.string().min(1),
    apiSalt: z.string().min(1),
    baseUrl: z.string().url().optional(),
  })
  .strict();

const TpipayCredentialsSchema = z
  .object({
    apiToken: z.string().min(1),
    baseUrl: z.string().url().optional(),
    payoutBaseUrl: z.string().url().optional(),
    payeeAccountType: z.string().optional(),
  })
  .strict();

const PayprimeCredentialsSchema = z
  .object({
    apiToken: z.string().min(1),
  })
  .strict();

const PaysixCredentialsSchema = z
  .object({
    merchantId: z.string().min(1),
    apiSecret: z.string().min(1),
    baseUrl: z.string().url().optional(),
  })
  .strict();

export const PROVIDER_REGISTRY = {
  dummy: {
    credentialsSchema: DummyCredentialsSchema,
    create: (config) => new DummyProvider(config),
    allowEmptyCredentials: true,
  },
  sabiopay: {
    credentialsSchema: SabioPayCredentialsSchema,
    create: (config) => new SabioPayProvider(config),
  },
  easemyneeds: {
    credentialsSchema: EaseMyNeedsCredentialsSchema,
    create: (config) => new EaseMyNeedsProvider(config),
  },
  tpipay: {
    credentialsSchema: TpipayCredentialsSchema,
    create: (config) => new TpipayProvider(config),
  },
  payprime: {
    credentialsSchema: PayprimeCredentialsSchema,
    create: (config) => new PayprimeProvider(config),
  },
  paysix: {
    credentialsSchema: PaysixCredentialsSchema,
    create: (config) => new PaysixProvider(config),
  },

} satisfies Record<string, ProviderRegistration<Record<string, string>>>;

export type ProviderRegistryKey = keyof typeof PROVIDER_REGISTRY;

export function getProviderRegistration(providerId: string):
  | ProviderRegistration<Record<string, string>>
  | undefined {
  const key = providerId.toLowerCase();
  return (PROVIDER_REGISTRY as Record<
    string,
    ProviderRegistration<Record<string, string>>
  >)[key];
}
