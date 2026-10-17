import btcpay from '@provisia/gateway-btcpay';
import mollie from '@provisia/gateway-mollie';
import paypal from '@provisia/gateway-paypal';
import stripe from '@provisia/gateway-stripe';
import {
  ModuleRegistry,
  type PaymentGateway,
  type Provisioner,
  type Registrar,
} from '@provisia/module-sdk';
import cpanel from '@provisia/provisioner-cpanel';
import directadmin from '@provisia/provisioner-directadmin';
import plesk from '@provisia/provisioner-plesk';
import proxmox from '@provisia/provisioner-proxmox';
import { skrimeServer, skrimeWebspace } from '@provisia/provisioner-skrime';
import skrime from '@provisia/registrar-skrime';

/**
 * Static list of installed plugin modules. Feature agents add one import + one array entry:
 *
 *   import stripe from '@provisia/gateway-stripe';
 *   const gateways: PaymentGateway[] = [stripe];
 */
const gateways: PaymentGateway[] = [stripe, paypal, mollie, btcpay];
const registrars: Registrar[] = [skrime];
const provisioners: Provisioner[] = [
  cpanel,
  plesk,
  directadmin,
  proxmox,
  skrimeWebspace,
  skrimeServer,
];

export function loadModules(registry = new ModuleRegistry()): ModuleRegistry {
  for (const g of gateways) registry.register('gateway', g);
  for (const r of registrars) registry.register('registrar', r);
  for (const p of provisioners) registry.register('provisioner', p);
  return registry;
}
