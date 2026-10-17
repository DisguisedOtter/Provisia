import {
  ModuleRegistry,
  type PaymentGateway,
  type Provisioner,
  type Registrar,
} from '@provisia/module-sdk';

/**
 * Static list of installed plugin modules. Feature agents add one import + one array entry:
 *
 *   import stripe from '@provisia/gateway-stripe';
 *   const gateways: PaymentGateway[] = [stripe];
 */
const gateways: PaymentGateway[] = [];
const registrars: Registrar[] = [];
const provisioners: Provisioner[] = [];

export function loadModules(registry = new ModuleRegistry()): ModuleRegistry {
  for (const g of gateways) registry.register('gateway', g);
  for (const r of registrars) registry.register('registrar', r);
  for (const p of provisioners) registry.register('provisioner', p);
  return registry;
}
