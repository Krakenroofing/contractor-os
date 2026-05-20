import 'server-only';
import { getActiveCompanyId } from '@/lib/active-company';
import { listCustomers, getCustomer } from '@/lib/data/customers';
import { listProjects as listProjectsData, getProject } from '@/lib/data/projects';
import type { Project } from '@/db/schema';

export type ProjectListRow = {
  id: string;
  name: string;
  status: Project['status'];
  customerId: string;
  customerName: string;
  contractValue: string;
  currentBudget: string;
  totalChangeOrders: string;
  startDate: string | null;
  targetCompletionDate: string | null;
};

export async function listProjects(): Promise<ProjectListRow[]> {
  const companyId = await getActiveCompanyId();
  const [projects, customers] = await Promise.all([
    listProjectsData(companyId),
    listCustomers(companyId),
  ]);
  const customerById = new Map(customers.map((c) => [c.id, c]));
  return projects.map((p) => {
    const customer = customerById.get(p.customerId);
    return {
      id: p.id,
      name: p.name,
      status: p.status,
      customerId: p.customerId,
      customerName: customer?.name ?? 'Unknown customer',
      contractValue: p.contractValue,
      currentBudget: p.currentBudget,
      totalChangeOrders: p.totalChangeOrders,
      startDate: p.startDate,
      targetCompletionDate: p.targetCompletionDate,
    };
  });
}

export async function getProjectById(id: string) {
  const companyId = await getActiveCompanyId();
  const project = await getProject(companyId, id);
  if (!project) return null;
  const customer = await getCustomer(companyId, project.customerId);
  if (!customer) return null;
  return { project, customer };
}
