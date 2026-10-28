import assert from "node:assert/strict";
import test from "node:test";
import {
  buildLineItemFromFields,
  extractProposalFieldsFromText,
  fieldsFromProposalDocument,
  finalizeExtraction,
  mergeExtractionFields,
} from "./proposalExtraction";
import { extractCoverContact, extractIsoStandards, extractProposedScope, parseProposalText } from "./proposalExtractionParse";

const LEGACY_PROPOSAL = `
CONSULTING PROPOSAL
ISO 9001:2015 Quality Management System
Proposal No. P-202608-001 Rev. 0
Prepared for:
Ms. Wong Mei Ling
XYZ Logistics Limited
Tel: 2555 1234
Email: mei.ling@xyz.com
Proposal Issued:
21 August 2026

Introduction
To assist XYZ Logistics Limited (THE CLIENT) to set up ISO 9001:2015 Quality Management System.

Address:
Unit 1, 12/F, Sample Building, Kowloon

Scope:
Provision of freight forwarding, warehousing and logistics services

Proposed scope of Certification
Provision of freight forwarding, warehousing and logistics services

Remark: The proposed scope is subject to confirmation by the certification body.

The Approach
Our consultancy service is structured into sequential phases.

Phase 1: System Review & Foundation
Client Service: Review existing processes and documents with department representatives.
Client responsibility: Provide department representatives and current process documentation.
Deliverable: Gap analysis report and agreed action list

Phase 2: System Documentation
Client Service: Draft the quality manual, procedures and forms; conduct awareness training.
Client responsibility: Review drafts and attend training.
Deliverable: Approved QMS documentation set

Phase 3: System Implementation & Internal Check
Client Service: On-site advisory visits, remote support, internal audit assistance.
Deliverable: Internal audit report

Project Timeline for ISO 9001
Month 1-2 Phase 1, Month 3 Phase 2, Month 4-5 Phase 3
`;

const IN_APP_COVER = `
CONSULTING PROPOSAL
ISO 14001:2015 & ISO 45001:2018
Proposal No. P-202608-002 Rev. 0
Prepared for:
Mr. Chan Tai Man
ABC Manufacturing Limited
Proposal Issued:
21 August 2026
Proposal Valid To:
21 November 2026
Contact: Thomas Yu, Managing Director
2366 4622
 · thomas@gabriel.hk
`;

test("extractCoverContact reads person, email and telephone from Prepared for", () => {
  const c = extractCoverContact(LEGACY_PROPOSAL);
  assert.equal(c.contactPerson, "Ms. Wong Mei Ling");
  assert.equal(c.contactEmail, "mei.ling@xyz.com");
  assert.equal(c.contactPhone, "2555 1234");
});

test("extractCoverContact leaves telephone empty when the cover only names the person", () => {
  const c = extractCoverContact(IN_APP_COVER);
  assert.equal(c.contactPerson, "Mr. Chan Tai Man");
  assert.equal(c.contactEmail, "");
  assert.equal(c.contactPhone, "");
});

test("extractIsoStandards finds ISO codes with years", () => {
  assert.deepEqual(extractIsoStandards(LEGACY_PROPOSAL), ["ISO 9001:2015"]);
  assert.deepEqual(extractIsoStandards(IN_APP_COVER), ["ISO 14001:2015", "ISO 45001:2018"]);
});

test("extractProposedScope reads the certification scope heading", () => {
  const scope = extractProposedScope(LEGACY_PROPOSAL);
  assert.match(scope, /freight forwarding/i);
  assert.doesNotMatch(scope, /The Approach/);
});

test("parseProposalText maps The Approach client service, responsibility and deliverable per phase", () => {
  const parsed = parseProposalText(LEGACY_PROPOSAL);
  assert.equal(parsed.contactPerson, "Ms. Wong Mei Ling");
  assert.equal(parsed.approachPhases.length, 3);
  assert.equal(parsed.approachPhases[0].title, "System Review & Foundation");
  assert.match(parsed.approachPhases[0].clientService, /Review existing processes/);
  assert.match(parsed.approachPhases[0].clientResponsibility, /department representatives/);
  assert.match(parsed.approachPhases[0].deliverable, /Gap analysis/);
  assert.equal(parsed.approachPhases[2].clientResponsibility, "");
  assert.match(parsed.approachPhases[2].deliverable, /Internal audit report/);
});

test("parseProposalText understands Our Activities / Your Involvement / Key Outcome labels", () => {
  const text = `
The Approach
Phase 1: System Review & Foundation
Objective: Understand current operations.
Our Activities: Meet key departments to review documents.
Your Involvement: Providing representatives for meetings.
Key Outcome: Agreed list of actions.
`;
  const parsed = parseProposalText(text);
  assert.equal(parsed.approachPhases[0].clientService, "Meet key departments to review documents.");
  assert.equal(parsed.approachPhases[0].clientResponsibility, "Providing representatives for meetings.");
  assert.equal(parsed.approachPhases[0].deliverable, "Agreed list of actions.");
});

test("buildLineItemFromFields uses ISO standard, certification scope and approach details", () => {
  const fields = extractProposalFieldsFromText(LEGACY_PROPOSAL);
  const item = buildLineItemFromFields(fields);
  assert.equal(item.name, "ISO 9001:2015 consulting");
  assert.match(item.description, /freight forwarding/);
  assert.match(item.details, /Client service:/);
  assert.match(item.details, /Client responsibility:/);
  assert.match(item.details, /Deliverable:/);
  assert.match(item.details, /Phase 1:/);
});

test("finalizeExtraction notes include cover contact and ISO standard", () => {
  const { notes } = finalizeExtraction(extractProposalFieldsFromText(LEGACY_PROPOSAL));
  assert.match(notes, /Contact person: Ms\. Wong Mei Ling/);
  assert.match(notes, /Email: mei\.ling@xyz\.com/);
  assert.match(notes, /Telephone: 2555 1234/);
  assert.match(notes, /ISO standard: ISO 9001:2015/);
  assert.match(notes, /Proposed scope of certification/);
  assert.match(notes, /The Approach/);
});

test("fieldsFromProposalDocument maps client contact, ISO, scope and rendered approach blocks", () => {
  const fields = fieldsFromProposalDocument({
    client: {
      contactPerson: "Mr. Chan Tai Man",
      email: "chan@abc.com",
      phone: "2888 0000",
    },
    isoStandards: ["ISO 9001:2015"],
    proposalScope: "Manufacture of plastic parts",
    scopePhases: [
      {
        phase: 1,
        title: "Gap analysis",
        description: "Review current QMS.",
        deliverable: "Gap report",
        weeks: 6,
      },
    ],
    vars: {
      "service.standards_display": "ISO 9001:2015",
      "service.system_issues_display": "quality issues",
      "service.management_system_full_display": "quality management system",
      "service.policy_name": "Quality Policy",
      "service.manual_name": "Quality Manual",
      "service.procedures_name": "procedures",
      "service.system_abbreviations_display": "QMS",
      "service.standards_short_display": "ISO 9001",
    },
  });
  assert.equal(fields.contactPerson, "Mr. Chan Tai Man");
  assert.equal(fields.contactEmail, "chan@abc.com");
  assert.equal(fields.contactPhone, "2888 0000");
  assert.deepEqual(fields.isoStandards, ["ISO 9001:2015"]);
  assert.equal(fields.proposedScopeOfCertification, "Manufacture of plastic parts");
  assert.equal(fields.approachPhases.length, 1);
  assert.equal(fields.approachPhases[0].title, "Gap analysis");
  assert.match(fields.approachPhases[0].clientService, /Review current QMS/);
  assert.match(fields.approachPhases[0].clientResponsibility, /department representatives/i);
  assert.equal(fields.approachPhases[0].deliverable, "Gap report");
});

test("mergeExtractionFields keeps cover contact from the text parse when AI omits it", () => {
  const heuristic = extractProposalFieldsFromText(LEGACY_PROPOSAL);
  const merged = mergeExtractionFields(heuristic, {
    ...heuristic,
    contactPerson: "",
    contactEmail: "",
    contactPhone: "",
    proposedScopeOfCertification: heuristic.proposedScopeOfCertification,
  });
  assert.equal(merged.contactPerson, "Ms. Wong Mei Ling");
  assert.equal(merged.contactEmail, "mei.ling@xyz.com");
  assert.equal(merged.contactPhone, "2555 1234");
});
