// Set test environment
process.env.NODE_ENV = 'test';

// Add custom matchers if needed
expect.extend({
  toBeValidSession(received) {
    const pass =
      received &&
      typeof received.id === 'string' &&
      typeof received.command === 'string' &&
      typeof received.workingDir === 'string' &&
      ['running', 'exited'].includes(received.status);

    return {
      pass,
      message: () =>
        pass
          ? `expected ${received} not to be a valid session`
          : `expected ${received} to be a valid session`,
    };
  },
});
