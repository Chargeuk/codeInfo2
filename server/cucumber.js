export default {
  default: {
    requireModule: ['tsx/register'],
    require: ['src/test/steps/**/*.ts'],
    paths: ['src/test/features/**/*.feature'],
    publishQuiet: true,
  },
};
