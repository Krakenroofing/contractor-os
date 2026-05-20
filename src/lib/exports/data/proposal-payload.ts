import 'server-only';
import { getProposal } from '@/lib/data/proposals';
import { getProject } from '@/lib/data/projects';
import { getCustomer } from '@/lib/data/customers';
import { getActiveCompany } from '@/lib/active-company';
import { buildCompanyInfo } from '@/lib/exports/data/company-info';
import { parseMoney } from '@/lib/money';
import type {
  DocumentPayload,
  DocumentMeta,
  DocumentSection,
} from '@/lib/exports/types';

export async function buildProposalPayload(
  companyId: string,
  proposalId: string,
): Promise<DocumentPayload | null> {
  const proposal = await getProposal(companyId, proposalId);
  if (!proposal) return null;

  const company = await getActiveCompany();
  const project = await getProject(companyId, proposal.projectId);
  const customer = project
    ? await getCustomer(companyId, project.customerId)
    : undefined;

  const meta: DocumentMeta[] = [
    { label: 'Proposal #', value: proposal.number },
  ];
  if (proposal.proposalDate) {
    meta.push({ label: 'Proposal date', value: proposal.proposalDate });
  }
  if (proposal.expiryDate) {
    meta.push({ label: 'Valid until', value: proposal.expiryDate });
  }

  const sections: DocumentSection[] = [];
  if (proposal.scopeOfWork) {
    sections.push({ title: 'Scope of work', body: proposal.scopeOfWork });
  }
  if (proposal.inclusions) {
    sections.push({ title: 'Inclusions', body: proposal.inclusions });
  }
  if (proposal.exclusions) {
    sections.push({ title: 'Exclusions', body: proposal.exclusions });
  }
  if (proposal.paymentSchedule) {
    sections.push({
      title: 'Payment schedule',
      body: proposal.paymentSchedule,
    });
  }
  if (proposal.warrantyNotes) {
    sections.push({ title: 'Warranty', body: proposal.warrantyNotes });
  }
  if (proposal.termsAndConditions) {
    sections.push({
      title: 'Terms and conditions',
      body: proposal.termsAndConditions,
    });
  }

  return {
    type: 'proposal',
    title: 'Proposal',
    number: proposal.number,
    statusLabel: proposal.status,
    company: await buildCompanyInfo(company),
    customer: customer
      ? {
          name: customer.name,
          contact: customer.primaryContactName,
          email: customer.email,
          phone: customer.phone,
          addressLine1: customer.billingAddressLine1,
          city: customer.billingCity,
          state: customer.billingState,
          postalCode: customer.billingPostalCode,
          tinNumber: customer.tinNumber,
        }
      : undefined,
    project: project
      ? {
          name: project.name,
          description: project.notes,
        }
      : undefined,
    meta,
    totals: [
      { label: 'Proposal total', value: parseMoney(proposal.total), bold: true },
    ],
    sections,
    footerNote: null,
  };
}
