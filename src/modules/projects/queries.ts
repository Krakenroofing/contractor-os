import 'server-only';
import { getActiveCompanyId } from '@/lib/active-company';
import { getMockCustomer, getMockProject, listMockProjects } from '@/lib/mock-store';
import type { Project } from '@/db/schema';

export type ProjectListRow = {
  id: string;
  number: string;
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
  return listMockProjects(companyId).map((p) => {
    const customer = getMockCustomer(companyId, p.customerId);
    return {
      id: p.id,
      number: p.number,
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
  const project = getMockProject(companyId, id);
  if (!project) return null;
  const customer = getMockCustomer(companyId, project.customerId);
  if (!customer) return null;
  return { project, customer };
}
