import { NEXT_PUBLIC_WEBAPP_URL } from '@documenso/lib/constants/app';

export const appMetaTags = (title?: string) => {
  const description =
    'HubSign is the open signing infrastructure for modern businesses. Get a 10x better document signing experience — fast, smart, and beautiful. Integrates with your favorite tools, fully customizable and expandable.';

  return [
    {
      title: title ? `${title} - HubSign` : 'HubSign',
    },
    {
      name: 'description',
      content: description,
    },
    {
      name: 'keywords',
      content:
        'HubSign, digital signatures, document signing, e-signature, open signing infrastructure, smart templates, secure signing, electronic documents',
    },
    {
      name: 'author',
      content: 'Future Edge Technology Inc.',
    },
    {
      name: 'robots',
      content: 'index, follow',
    },
    {
      property: 'og:title',
      content: 'HubSign',
    },
    {
      property: 'og:description',
      content: description,
    },
    {
      property: 'og:image',
      content: `${NEXT_PUBLIC_WEBAPP_URL()}/opengraph-image.jpg?v=2`,
    },
    {
      property: 'og:image:width',
      content: '1200',
    },
    {
      property: 'og:image:height',
      content: '630',
    },
    {
      property: 'og:image:alt',
      content: 'HubSign — the open signing infrastructure for modern businesses.',
    },
    {
      property: 'og:site_name',
      content: 'HubSign',
    },
    {
      property: 'og:type',
      content: 'website',
    },
    {
      name: 'twitter:card',
      content: 'summary_large_image',
    },
    {
      name: 'twitter:site',
      content: '@hubsign',
    },
    {
      name: 'twitter:description',
      content: description,
    },
    {
      name: 'twitter:image',
      content: `${NEXT_PUBLIC_WEBAPP_URL()}/opengraph-image.jpg?v=2`,
    },
  ];
};
