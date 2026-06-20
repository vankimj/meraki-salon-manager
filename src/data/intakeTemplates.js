// Default intake / waiver form templates a tenant can import in one click from
// the Intake & Waivers module. Personal-training tenants get the PAR-Q, a
// health-history + goals intake, and a liability waiver seeded automatically;
// any vertical can import them by hand.
//
// Question `kind` is one of:
//   short_text | long_text | single_choice | multi_choice | yes_no | number | date | signature
// A form of `type: 'waiver'` is expected to end with a `signature` question and
// is treated as a legal record (the response snapshots the form version).

let _qid = 0;
const q = (kind, label, extra = {}) => ({ id: `q${++_qid}`, kind, label, required: false, ...extra });

export const INTAKE_TEMPLATES = [
  {
    id: 'parq',
    name: 'PAR-Q+ Readiness Screen',
    type: 'intake',
    vertical: 'personalTraining',
    description: 'Physical Activity Readiness Questionnaire — screen before the first session.',
    questions: [
      q('yes_no', 'Has your doctor ever said that you have a heart condition OR high blood pressure?', { required: true }),
      q('yes_no', 'Do you feel pain in your chest at rest, during daily activity, or during physical activity?', { required: true }),
      q('yes_no', 'Do you lose balance because of dizziness or have you lost consciousness in the last 12 months?', { required: true }),
      q('yes_no', 'Have you ever been diagnosed with another chronic medical condition (other than heart disease or high blood pressure)?', { required: true }),
      q('yes_no', 'Are you currently taking prescribed medications for a chronic medical condition?', { required: true }),
      q('yes_no', 'Do you have a bone, joint, or soft-tissue problem that could be made worse by becoming more physically active?', { required: true }),
      q('yes_no', 'Has your doctor ever said you should only do medically supervised physical activity?', { required: true }),
      q('long_text', 'If you answered YES to any question above, please describe.', { placeholder: 'Condition, medication, or injury details' }),
    ],
  },
  {
    id: 'health-history',
    name: 'Health History & Goals',
    type: 'intake',
    vertical: 'personalTraining',
    description: 'Baseline health background, lifestyle, and training goals.',
    questions: [
      q('single_choice', 'How would you describe your current activity level?', { required: true, options: ['Sedentary', 'Lightly active', 'Moderately active', 'Very active'] }),
      q('multi_choice', 'What are your primary goals?', { options: ['Fat loss', 'Build muscle', 'Strength', 'Endurance', 'Mobility / flexibility', 'Sport-specific', 'General health'] }),
      q('long_text', 'Do you have any current or past injuries we should know about?', { placeholder: 'Area, when it happened, current status' }),
      q('long_text', 'List any medications, allergies, or medical conditions.', {}),
      q('number', 'On a scale of 1–10, how would you rate your current stress level?', {}),
      q('single_choice', 'How many days per week can you commit to training?', { required: true, options: ['1', '2', '3', '4', '5+'] }),
      q('short_text', 'Emergency contact name', { required: true }),
      q('short_text', 'Emergency contact phone', { required: true }),
      q('long_text', 'Anything else your trainer should know?', {}),
    ],
  },
  {
    id: 'liability-waiver',
    name: 'Liability Waiver & Release',
    type: 'waiver',
    vertical: 'personalTraining',
    description: 'Assumption of risk and release of liability. Client e-signs before training.',
    questions: [
      q('long_text', 'Waiver & Release of Liability', {
        readOnly: true,
        body: 'I understand that participating in physical exercise and personal training carries an inherent risk of injury. I voluntarily assume all such risks. I confirm that I am physically able to participate and have disclosed any relevant medical conditions. I release and hold harmless the trainer and studio from any claim, injury, or damage arising from my participation, to the fullest extent permitted by law. I have read and understood this waiver.',
      }),
      q('yes_no', 'I have read and agree to the waiver above.', { required: true }),
      q('signature', 'Signature', { required: true }),
    ],
  },
];

// Reset the module-level id counter export so callers that import templates
// repeatedly in tests get stable ids on each fresh module load.
export function intakeTemplatesForVertical(verticalKey) {
  return INTAKE_TEMPLATES.filter(t => !t.vertical || t.vertical === verticalKey);
}

export const QUESTION_KINDS = [
  { kind: 'short_text',    label: 'Short text' },
  { kind: 'long_text',     label: 'Paragraph' },
  { kind: 'single_choice', label: 'Single choice' },
  { kind: 'multi_choice',  label: 'Multiple choice' },
  { kind: 'yes_no',        label: 'Yes / No' },
  { kind: 'number',        label: 'Number' },
  { kind: 'date',          label: 'Date' },
  { kind: 'signature',     label: 'Signature' },
];
