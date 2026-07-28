import clientPackage from '../../package.json';

const TESTING_LIBRARY_DOM_VERSION = '10.4.1';

test('Testing Library DOM remains a direct client development dependency', () => {
  expect(clientPackage.devDependencies['@testing-library/dom']).toBe(
    TESTING_LIBRARY_DOM_VERSION,
  );
});
