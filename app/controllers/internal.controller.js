const axios = require('axios')
const jwt = require('jsonwebtoken')

const doInternalApi = async ({
  method = "GET",
  url,
  data,
  userData,
  params = {},
}) => {
  try {
    const response = await axios({
      method,
      url,
      data,
      headers: {
        Authorization: jwt.sign(userData,process.env.JWT_SECRET,{expiresIn:'7d'}),
      },
      params,
    });
    return response.data;
  } catch (error) {
    console.log(error);
    return {
      error,
    };
  }
};

module.exports = doInternalApi
