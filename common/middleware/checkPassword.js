function checkPassword({ password, ...options }) {
  const {
    app: { config, error },
  } = this;

  if (password !== config.password) {
    throw new error.PermissionsError('password error');
  }

  return options;
}

module.exports = checkPassword;
