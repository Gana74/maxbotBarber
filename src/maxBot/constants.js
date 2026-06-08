/** Шаги сценария записи (для rate limiter и booking flow). */
const BOOKING_STEP_VALUES = new Set([
  "choosing_service",
  "choosing_date",
  "choosing_time",
  "awaiting_name",
  "awaiting_contact",
  "awaiting_comment",
  "confirming",
]);

/**
 * Активен ли сценарий записи по session.step.
 * @param {object} [session]
 * @returns {boolean}
 */
function isBookingStepActive(session) {
  return Boolean(session?.step && BOOKING_STEP_VALUES.has(session.step));
}

module.exports = {
  BOOKING_STEP_VALUES,
  isBookingStepActive,
};
