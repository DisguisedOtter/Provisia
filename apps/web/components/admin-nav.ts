import {
  ArrowLeftRight,
  Boxes,
  FileText,
  Globe,
  LayoutDashboard,
  LifeBuoy,
  Package,
  Server,
  Settings,
  ShoppingCart,
  Users,
} from 'lucide-react';

/** Admin sidebar. Feature agents add entries here. */
export const adminNav = [
  { href: '/admin', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/admin/clients', label: 'Clients', icon: Users },
  { href: '/admin/orders', label: 'Orders', icon: ShoppingCart },
  { href: '/admin/products', label: 'Products', icon: Package },
  { href: '/admin/services', label: 'Services', icon: Boxes },
  { href: '/admin/domains', label: 'Domains', icon: Globe },
  { href: '/admin/invoices', label: 'Invoices', icon: FileText },
  { href: '/admin/transactions', label: 'Transactions', icon: ArrowLeftRight },
  { href: '/admin/tickets', label: 'Tickets', icon: LifeBuoy },
  { href: '/admin/servers', label: 'Servers', icon: Server },
  { href: '/admin/settings', label: 'Settings', icon: Settings },
];
