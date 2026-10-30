import { experimental_decide as decide } from 'ai';
import { nace } from 'nace-ai-provider';

const { answers, providerMetadata, usage } = await decide({
  model: nace.decisionModel('drex-v2.0'),
  state: 'My order #1042 arrived broken and I want my money back.',
  questions: {
    refund: {
      type: 'boolean',
      instructions: 'Does the customer ask for a refund?',
    },
    topic: {
      type: 'choice',
      instructions: 'What is the ticket about?',
      criteria: {
        billing: 'Payments, refunds, invoices',
        shipping: 'Delivery and damaged items',
        other: null,
      },
    },
    urgency: {
      type: 'score',
      instructions: 'How urgent is the ticket?',
      criteria: ['Not urgent', 'Somewhat urgent', 'Very urgent'],
    },
  },
});

console.log(answers.refund.probability);
console.log(answers.topic.choice, answers.topic.probabilities);
console.log(answers.urgency.score);
console.log(providerMetadata?.nace?.confidence, usage);
