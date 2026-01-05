const transporter = require("../../config/nodemailer");

const sendMailFunc = ({ to, subject, html, cc }) => {
  return new Promise((resolve, reject) => {
    if (!(to && subject && html)) {
      return reject({
        isSend: false,
        error: `(to: ${to}), (subject: ${subject}) and (html: ${html}) is required!`,
      });
    }

    const data = {
      from: process.env.EMAIL,
      to: Array.isArray(to) ? to.join(", ") : to,
      cc: cc ? (Array.isArray(cc) ? cc.join(", ") : cc) : undefined, // added CC
      subject,
      html,
    };

    // console.log("data", data);

    transporter.sendMail(data, (error) => {
      if (error) {
        reject({
          isSend: false,
          error,
        });
      } else {
        resolve({
          isSend: true,
          data,
        });
      }
    });
  });
};

module.exports = {
  sendMailFunc,
};