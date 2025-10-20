const moment = require('moment-timezone');

/**
 * Get business day boundaries based on restaurant operating hours
 * @param {Object} operatingHours - Restaurant operating hours
 * @param {string} operatingHours.openingTime - Opening time (HH:MM format)
 * @param {string} operatingHours.closingTime - Closing time (HH:MM format)
 * @param {string} operatingHours.timezone - Restaurant timezone
 * @param {Date} referenceDate - Date to calculate boundaries for
 * @returns {Object} - { startDate, endDate }
 */
function getBusinessDayBoundaries(operatingHours, referenceDate = new Date()) {
    const { openingTime, closingTime, timezone } = operatingHours;
    
    // Parse opening and closing times
    const [openingHour, openingMinute] = openingTime.split(':').map(Number);
    const [closingHour, closingMinute] = closingTime.split(':').map(Number);
    
    // Convert reference date to restaurant timezone
    const restaurantDate = moment.tz(referenceDate, timezone);
    
    // Check if closing time is next day (cross-midnight scenario)
    const isCrossMidnight = closingHour < openingHour || 
                           (closingHour === openingHour && closingMinute < openingMinute);
    
    let startDate, endDate;
    
    if (isCrossMidnight) {
        // Cross-midnight scenario: business day starts previous day
        const currentTime = restaurantDate.format('HH:mm');
        
        if (currentTime >= openingTime) {
            // We're in the business day that started today
            startDate = restaurantDate.clone().startOf('day').hour(openingHour).minute(openingMinute).toDate();
            endDate = restaurantDate.clone().add(1, 'day').startOf('day').hour(closingHour).minute(closingMinute).toDate();
        } else {
            // We're in the business day that started yesterday
            startDate = restaurantDate.clone().subtract(1, 'day').startOf('day').hour(openingHour).minute(openingMinute).toDate();
            endDate = restaurantDate.clone().startOf('day').hour(closingHour).minute(closingMinute).toDate();
        }
    } else {
        // Normal scenario: business day within same calendar day
        startDate = restaurantDate.clone().startOf('day').hour(openingHour).minute(openingMinute).toDate();
        endDate = restaurantDate.clone().startOf('day').hour(closingHour).minute(closingMinute).toDate();
    }
    
    return { startDate, endDate };
}

/**
 * Get business week boundaries based on restaurant operating hours
 * @param {Object} operatingHours - Restaurant operating hours
 * @param {Date} referenceDate - Date to calculate boundaries for
 * @returns {Object} - { startDate, endDate }
 */
function getBusinessWeekBoundaries(operatingHours, referenceDate = new Date()) {
    const { startDate: businessDayStart } = getBusinessDayBoundaries(operatingHours, referenceDate);
    
    // Find the start of the business week (Sunday)
    const weekStart = moment.tz(businessDayStart, operatingHours.timezone)
        .startOf('week')
        .toDate();
    
    // Get business day boundaries for the start of the week
    const weekStartBusinessDay = getBusinessDayBoundaries(operatingHours, weekStart);
    
    // Get business day boundaries for the end of the week
    const weekEnd = moment.tz(weekStart, operatingHours.timezone)
        .endOf('week')
        .toDate();
    const weekEndBusinessDay = getBusinessDayBoundaries(operatingHours, weekEnd);
    
    return {
        startDate: weekStartBusinessDay.startDate,
        endDate: weekEndBusinessDay.endDate
    };
}

/**
 * Get business month boundaries based on restaurant operating hours
 * @param {Object} operatingHours - Restaurant operating hours
 * @param {Date} referenceDate - Date to calculate boundaries for
 * @returns {Object} - { startDate, endDate }
 */
function getBusinessMonthBoundaries(operatingHours, referenceDate = new Date()) {
    const { startDate: businessDayStart } = getBusinessDayBoundaries(operatingHours, referenceDate);
    
    // Get the first day of the month in restaurant timezone
    const monthStart = moment.tz(businessDayStart, operatingHours.timezone)
        .startOf('month')
        .toDate();
    
    // Get the last day of the month in restaurant timezone
    const monthEnd = moment.tz(businessDayStart, operatingHours.timezone)
        .endOf('month')
        .toDate();
    
    // Get business day boundaries for start and end of month
    const monthStartBusinessDay = getBusinessDayBoundaries(operatingHours, monthStart);
    const monthEndBusinessDay = getBusinessDayBoundaries(operatingHours, monthEnd);
    
    return {
        startDate: monthStartBusinessDay.startDate,
        endDate: monthEndBusinessDay.endDate
    };
}

/**
 * Check if a given time falls within business hours
 * @param {Date} orderTime - Time to check
 * @param {Object} operatingHours - Restaurant operating hours
 * @returns {boolean} - True if within business hours
 */
function isWithinBusinessHours(orderTime, operatingHours) {
    const { openingTime, closingTime, timezone } = operatingHours;
    
    const orderMoment = moment.tz(orderTime, timezone);
    const [openingHour, openingMinute] = openingTime.split(':').map(Number);
    const [closingHour, closingMinute] = closingTime.split(':').map(Number);
    
    const isCrossMidnight = closingHour < openingHour || 
                           (closingHour === openingHour && closingMinute < openingMinute);
    
    if (isCrossMidnight) {
        // Cross-midnight scenario
        const openingTimeToday = orderMoment.clone().startOf('day').hour(openingHour).minute(openingMinute);
        const closingTimeToday = orderMoment.clone().startOf('day').hour(closingHour).minute(closingMinute);
        const openingTimeYesterday = orderMoment.clone().subtract(1, 'day').startOf('day').hour(openingHour).minute(openingMinute);
        
        return orderMoment.isBetween(openingTimeYesterday, closingTimeToday, null, '[)') ||
               orderMoment.isBetween(openingTimeToday, closingTimeToday.add(1, 'day'), null, '[)');
    } else {
        // Normal scenario
        const openingTimeToday = orderMoment.clone().startOf('day').hour(openingHour).minute(openingMinute);
        const closingTimeToday = orderMoment.clone().startOf('day').hour(closingHour).minute(closingMinute);
        
        return orderMoment.isBetween(openingTimeToday, closingTimeToday, null, '[)');
    }
}

module.exports = {
    getBusinessDayBoundaries,
    getBusinessWeekBoundaries,
    getBusinessMonthBoundaries,
    isWithinBusinessHours
};
