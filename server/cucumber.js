export default {
  default: {
    requireModule: ['tsx/register'],
    require: ['src/test/support/chromaContainer.ts', 'src/test/steps/**/*.ts'],
    paths: ['src/test/features/**/*.feature'],
    tags: 'not @skip',
    publishQuiet: true,
  },
};
