// ═══════════════════════════════════════════════════════════════
// LEGAL CONTENT — Privacy Policy, Terms of Use & Copyright
// Rendered by LegalPage and referenced by LegalFooter.
// ═══════════════════════════════════════════════════════════════

export const COMPANY = 'Unified POS';
export const PARENT_COMPANY = 'Glorified Technology Solution (GTS)';

/** Exact copyright line requested — do not alter wording. */
export const COPYRIGHT =
  'Copyright by Unified POS. All Rights Reserved. A Division of Glorified Technology Solution (GTS).';

export const LEGAL_LAST_UPDATED = 'September 6, 2026';

export const CONTACT_EMAIL = 'legal@unifiedpos.com';
export const SUPPORT_EMAIL = 'support@unifiedpos.com';

export interface LegalSection {
  heading: string;
  body: string[];
  bullets?: string[];
}

export interface LegalDocument {
  slug: string;
  title: string;
  intro: string;
  sections: LegalSection[];
}

export const PRIVACY_POLICY: LegalDocument = {
  slug: 'privacy',
  title: 'Privacy Policy',
  intro:
    'Unified POS ("we", "us", or "our"), a division of Glorified Technology Solution (GTS), respects your privacy. This Privacy Policy explains what information we collect, how we use it, and the choices you have when using our point-of-sale platform and related services (the "Service").',
  sections: [
    {
      heading: '1. Information We Collect',
      body: ['We collect information you provide directly and information generated as you use the Service.'],
      bullets: [
        'Account & business data: name, email, phone, business name, industry, and the worldwide address you enter in Settings.',
        'Branding assets: logos, favicons, cover graphics, brand colors, and other media you upload to customize your business.',
        'Transactional data: products, orders, customers, payments, inventory, and employee records you create within your organization.',
        'Technical data: device information, IP address, browser type, and usage logs used for security and diagnostics.',
      ],
    },
    {
      heading: '2. How We Use Your Information',
      body: ['We use collected information to operate and improve the Service, specifically to:'],
      bullets: [
        'Provide, maintain, and personalize your POS workspace and branding.',
        'Process transactions, generate receipts, and produce reports and analytics.',
        'Send service notifications such as low-stock alerts and system updates.',
        'Detect, prevent, and address fraud, abuse, and security incidents.',
        'Comply with legal, tax, and regulatory obligations across the nations we serve.',
      ],
    },
    {
      heading: '3. Data Ownership & Multi-Tenant Isolation',
      body: [
        'You retain ownership of your business data. Every record is scoped to your organization, and we enforce tenant isolation so one business cannot access another\u2019s data. We do not sell your personal or business information to third parties.',
      ],
    },
    {
      heading: '4. Sharing & Third-Party Integrations',
      body: [
        'We share information only as necessary to provide the Service. When you connect a third-party platform from the Developer Platform (payments, accounting, commerce, delivery, marketing, and similar), the data you authorize is exchanged with that provider under their own terms.',
      ],
      bullets: [
        'Service providers who host, secure, and support the platform.',
        'Integration partners you explicitly connect.',
        'Authorities where disclosure is required by law.',
      ],
    },
    {
      heading: '5. Data Retention',
      body: [
        'We retain your data for as long as your account is active or as needed to provide the Service. Financial and tax records may be retained for periods required by applicable law in your jurisdiction. You may request deletion of your organization and its data, subject to legal retention obligations.',
      ],
    },
    {
      heading: '6. Data Security',
      body: [
        'We apply administrative, technical, and physical safeguards including encrypted credentials, role-based access control, audit logging, and rate limiting. No method of transmission or storage is 100% secure, but we work to protect your information using commercially acceptable means.',
      ],
    },
    {
      heading: '7. Your Rights & Choices',
      body: ['Depending on your nation of residence, you may have the right to:'],
      bullets: [
        'Access, correct, or export your personal and business data.',
        'Restrict or object to certain processing.',
        'Request deletion of your data.',
        'Withdraw consent for optional data uses such as marketing.',
      ],
    },
    {
      heading: '8. International Transfers',
      body: [
        'The Service is designed for businesses in every nation around the world. Your information may be processed and stored in countries other than your own. By using the Service you consent to such transfers, which are carried out with appropriate safeguards.',
      ],
    },
    {
      heading: '9. Cookies & Local Storage',
      body: [
        'We use browser local storage and similar technologies to keep you signed in and remember your preferences. You can clear this data through your browser settings, though doing so may require you to sign in again.',
      ],
    },
    {
      heading: '10. Children\u2019s Privacy',
      body: [
        'The Service is intended for business use and is not directed to children. We do not knowingly collect personal information from children.',
      ],
    },
    {
      heading: '11. Changes to This Policy',
      body: [
        'We may update this Privacy Policy from time to time. Material changes will be communicated through the Service. Continued use after changes take effect constitutes acceptance of the revised policy.',
      ],
    },
    {
      heading: '12. Contact Us',
      body: [
        `Questions about this Privacy Policy can be sent to ${CONTACT_EMAIL}. Unified POS is a division of ${PARENT_COMPANY}.`,
      ],
    },
  ],
};

export const TERMS_OF_USE: LegalDocument = {
  slug: 'terms',
  title: 'Terms of Use',
  intro:
    'These Terms of Use ("Terms") govern your access to and use of the Unified POS platform and services (the "Service"), operated by Unified POS, a division of Glorified Technology Solution (GTS). By creating an account or using the Service you agree to these Terms.',
  sections: [
    {
      heading: '1. Acceptance of Terms',
      body: [
        'You must be of legal age and authorized to bind your business to these Terms. If you use the Service on behalf of an organization, you represent that you have authority to act for that organization.',
      ],
    },
    {
      heading: '2. Accounts & Security',
      body: [
        'You are responsible for safeguarding your account credentials and for all activity under your account. You agree to notify us promptly of any unauthorized use. We support role-based access so owners can control what employees may do.',
      ],
    },
    {
      heading: '3. Permitted Use',
      body: ['You agree to use the Service only for lawful business purposes. You must not:'],
      bullets: [
        'Use the Service to process unlawful sales or violate any applicable law or regulation.',
        'Attempt to gain unauthorized access to other organizations\u2019 data or the platform\u2019s systems.',
        'Reverse engineer, decompile, or disrupt the Service or its infrastructure.',
        'Upload malicious code, infringing content, or media you do not have rights to use.',
        'Circumvent rate limits, quotas, or security controls.',
      ],
    },
    {
      heading: '4. Subscriptions, Fees & Billing',
      body: [
        'Certain features may be offered under paid plans. Fees, where applicable, are billed in advance and are non-refundable except as required by law or explicitly stated. You are responsible for any transaction fees charged by the payment providers you connect.',
      ],
    },
    {
      heading: '5. Your Business Content',
      body: [
        'You retain all rights to the data, branding, logos, graphics, and media you upload. You grant us a limited license to host and display that content solely to operate and provide the Service to you.',
      ],
    },
    {
      heading: '6. Intellectual Property',
      body: [
        `The Service, including its software, design, text, and the Unified POS and ${PARENT_COMPANY} marks, is owned by us and protected by intellectual property laws. Except for your business content, we retain all right, title, and interest in the Service.`,
      ],
    },
    {
      heading: '7. Third-Party Integrations',
      body: [
        'The Developer Platform lets you connect third-party services. Those services are governed by their own terms and privacy policies. We are not responsible for the availability, accuracy, or conduct of third-party providers you choose to integrate.',
      ],
    },
    {
      heading: '8. Data & Backups',
      body: [
        'You are responsible for maintaining copies of critical business records. While we operate safeguards and synchronization features, we do not guarantee that the Service will be uninterrupted or error-free.',
      ],
    },
    {
      heading: '9. Service Modifications & Availability',
      body: [
        'We may add, change, or discontinue features and may perform maintenance that temporarily affects availability. We will provide reasonable notice of material changes where practicable.',
      ],
    },
    {
      heading: '10. Termination',
      body: [
        'You may stop using the Service at any time. We may suspend or terminate access if you breach these Terms or create risk for other users. Upon termination, your right to use the Service ceases, subject to applicable data-retention laws.',
      ],
    },
    {
      heading: '11. Disclaimers',
      body: [
        'THE SERVICE IS PROVIDED "AS IS" AND "AS AVAILABLE" WITHOUT WARRANTIES OF ANY KIND, WHETHER EXPRESS OR IMPLIED. WE DO NOT WARRANT THAT THE SERVICE WILL MEET YOUR REQUIREMENTS OR BE UNINTERRUPTED, SECURE, OR ERROR-FREE.',
      ],
    },
    {
      heading: '12. Limitation of Liability',
      body: [
        'TO THE MAXIMUM EXTENT PERMITTED BY LAW, UNIFIED POS AND GLORIFIED TECHNOLOGY SOLUTION (GTS) SHALL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR ANY LOSS OF PROFITS OR DATA, ARISING FROM YOUR USE OF THE SERVICE.',
      ],
    },
    {
      heading: '13. Indemnification',
      body: [
        'You agree to indemnify and hold harmless Unified POS, GTS, and their affiliates from claims arising out of your use of the Service, your business content, or your violation of these Terms or any law.',
      ],
    },
    {
      heading: '14. Governing Law & Disputes',
      body: [
        'These Terms are governed by the applicable laws of the jurisdiction in which your business operates. Any disputes shall be resolved in good faith, and where possible through mediation before litigation.',
      ],
    },
    {
      heading: '15. Changes to These Terms',
      body: [
        'We may update these Terms from time to time. Continued use of the Service after changes take effect constitutes acceptance of the revised Terms.',
      ],
    },
    {
      heading: '16. Contact',
      body: [
        `Questions about these Terms can be sent to ${SUPPORT_EMAIL}. Unified POS is a division of ${PARENT_COMPANY}.`,
      ],
    },
  ],
};

export const COOKIE_POLICY: LegalDocument = {
  slug: 'cookies',
  title: 'Cookie Policy',
  intro:
    'This Cookie Policy explains how Unified POS, a division of Glorified Technology Solution (GTS), uses cookies, browser local storage and similar technologies to operate the Service, remember your preferences and understand usage.',
  sections: [
    {
      heading: '1. What Are Cookies & Similar Technologies',
      body: [
        'Cookies are small text files stored by your browser. Local storage is a comparable browser mechanism that lets a web app keep data on your device. We use these technologies to authenticate you, secure your session and remember settings.',
      ],
    },
    {
      heading: '2. Categories We Use',
      body: ['Technologies are grouped by purpose:'],
      bullets: [
        'Strictly necessary — sign-in, security and core POS operations. These cannot be disabled.',
        'Functional — remember preferences such as language, theme and saved layouts.',
        'Analytics — aggregated usage measurement to improve the product (only with consent).',
        'Marketing — product news and promotional communications (only with consent).',
      ],
    },
    {
      heading: '3. Consent & Your Choices',
      body: [
        'Where required by law (for example the EU/UK ePrivacy rules), we ask for your consent before enabling non-essential technologies. You can change or withdraw consent at any time from the Compliance Center in the app, and your choices are recorded.',
      ],
    },
    {
      heading: '4. Local Storage in the Service',
      body: [
        'We store your authentication token and basic preferences in browser local storage so you stay signed in. Clearing this data will sign you out and reset local preferences.',
      ],
    },
    {
      heading: '5. Third-Party Technologies',
      body: [
        'When you connect an integration from the Developer Platform, that provider may use its own cookies or storage under its own policies. We do not control third-party technologies.',
      ],
    },
    {
      heading: '6. Managing Cookies',
      body: [
        'Most browsers let you refuse or delete cookies and local storage through their settings. Blocking strictly-necessary technologies may prevent the Service from functioning correctly.',
      ],
    },
    {
      heading: '7. Changes & Contact',
      body: [
        `We may update this Cookie Policy periodically. Questions can be sent to ${CONTACT_EMAIL}. Unified POS is a division of ${PARENT_COMPANY}.`,
      ],
    },
  ],
};

export const ACCESSIBILITY_STATEMENT: LegalDocument = {
  slug: 'accessibility',
  title: 'Accessibility Statement',
  intro:
    'Unified POS, a division of Glorified Technology Solution (GTS), is committed to ensuring digital accessibility for people of all abilities. We continually improve the Service so everyone can use it comfortably and independently.',
  sections: [
    {
      heading: '1. Our Commitment',
      body: [
        'We aim to conform to the Web Content Accessibility Guidelines (WCAG) 2.1 Level AA and to applicable accessibility laws such as the ADA, Section 508, EN 301 549 and the European Accessibility Act.',
      ],
    },
    {
      heading: '2. Measures We Take',
      body: ['Accessibility is considered throughout design and development:'],
      bullets: [
        'Semantic HTML structure with meaningful headings and landmarks.',
        'Labeled form fields, including international address and phone inputs.',
        'Visible focus indicators and full keyboard operability for core navigation.',
        'A contrast-aware color palette and scalable typography.',
        'Responsive layouts that work across screen sizes and zoom levels.',
      ],
    },
    {
      heading: '3. Known Limitations & Roadmap',
      body: [
        'A full conformance audit is in progress. Current focus areas include optimizing the POS product grid for keyboard-only operation, expanding screen-reader announcements for live totals, and adding captions or transcripts to any media.',
      ],
    },
    {
      heading: '4. Assistive Technology Support',
      body: [
        'The Service is designed to work with modern screen readers and browsers on desktop and mobile. If a feature does not work with your assistive technology, please contact us so we can help and improve it.',
      ],
    },
    {
      heading: '5. Feedback & Contact',
      body: [
        `We welcome your feedback on accessibility. Please report barriers to ${SUPPORT_EMAIL}. Unified POS is a division of ${PARENT_COMPANY}.`,
      ],
    },
  ],
};

export const REFUND_POLICY: LegalDocument = {
  slug: 'refunds',
  title: 'Refund & Return Policy',
  intro:
    'This policy explains refunds for Unified POS subscriptions and describes the tools your business uses to issue refunds to your own customers. Unified POS is a division of Glorified Technology Solution (GTS).',
  sections: [
    {
      heading: '1. Subscription Refunds',
      body: [
        'Paid plans, where offered, are billed in advance. Fees are non-refundable except where required by law or explicitly stated at checkout. If you cancel, your plan remains active until the end of the current billing period.',
      ],
    },
    {
      heading: '2. Cooling-Off & Consumer Rights',
      body: [
        'Consumers in certain jurisdictions have statutory withdrawal rights (for example the 14-day distance-selling right in the EU and the UK Consumer Contracts Regulations). Where these apply and have not been waived by your use of the Service, we honor them.',
      ],
    },
    {
      heading: '3. Refunds You Issue to Customers',
      body: [
        'The Payments module lets you void, refund and process returns for sales you make. You are responsible for setting and following your own store return policy and for complying with the consumer-protection laws that apply to your business and location.',
      ],
    },
    {
      heading: '4. How to Request a Subscription Refund',
      body: [
        `To request a refund of a Unified POS subscription charge, contact ${SUPPORT_EMAIL} with your organization name and billing details. Eligible refunds are typically processed to the original payment method within a reasonable period.`,
      ],
    },
    {
      heading: '5. Chargebacks & Disputes',
      body: [
        'Please contact us before initiating a chargeback so we can resolve the issue quickly. Chargebacks and disputes are handled through your connected payment provider according to card-network rules.',
      ],
    },
    {
      heading: '6. Regional Variations',
      body: [
        'Refund and return rights vary by nation. Where local law grants you rights that differ from this policy, those rights take precedence and this policy is read subject to them.',
      ],
    },
  ],
};

export const DATA_PROCESSING_AGREEMENT: LegalDocument = {
  slug: 'dpa',
  title: 'Data Processing Agreement (DPA)',
  intro:
    'This Data Processing Agreement ("DPA") governs the processing of personal data by Unified POS, a division of Glorified Technology Solution (GTS) ("Processor"), on behalf of you, the customer ("Controller"), when you use the Service.',
  sections: [
    {
      heading: '1. Roles & Scope',
      body: [
        'You are the controller of the personal data you and your employees enter into the Service; we are a processor acting on your documented instructions. This DPA applies to all such processing and supplements the Privacy Policy and Terms of Use.',
      ],
    },
    {
      heading: '2. Processor Obligations',
      body: ['We commit to:'],
      bullets: [
        'Process personal data only on your documented instructions.',
        'Ensure personnel are bound by confidentiality.',
        'Implement appropriate technical and organizational security measures.',
        'Assist you in responding to data-subject requests.',
        'Notify you of personal-data breaches without undue delay.',
        'Delete or return personal data at the end of the services, subject to legal retention.',
      ],
    },
    {
      heading: '3. Sub-Processors',
      body: [
        'We engage sub-processors (such as hosting and infrastructure providers) to deliver the Service. Integrations you connect from the Developer Platform act as your own third-party processors under their terms.',
      ],
    },
    {
      heading: '4. Security Measures',
      body: [
        'We apply measures including password hashing, token-based authentication, role-based access control, audit logging, rate limiting and encrypted transport, aligned to recognized information-security practices.',
      ],
    },
    {
      heading: '5. Data-Subject Requests',
      body: [
        'The Compliance Center provides self-service tools to export personal data and to submit deletion requests, helping you meet access, portability and erasure obligations under laws such as the GDPR and CCPA.',
      ],
    },
    {
      heading: '6. International Transfers',
      body: [
        'Personal data may be transferred to countries outside your own. Where required, transfers are made under appropriate safeguards such as Standard Contractual Clauses or equivalent mechanisms.',
      ],
    },
    {
      heading: '7. Term & Contact',
      body: [
        `This DPA remains in effect for as long as we process your personal data. Questions can be sent to ${CONTACT_EMAIL}. Unified POS is a division of ${PARENT_COMPANY}.`,
      ],
    },
  ],
};

export const LEGAL_DOCS: Record<string, LegalDocument> = {
  privacy: PRIVACY_POLICY,
  terms: TERMS_OF_USE,
  cookies: COOKIE_POLICY,
  accessibility: ACCESSIBILITY_STATEMENT,
  refunds: REFUND_POLICY,
  dpa: DATA_PROCESSING_AGREEMENT,
};
