
const { TOKEN_TYPE } = require('../token/const/token.constants');
const { TokenService } = require('../token/token.service');

const login = (req, res) => {

    // Validate user exists 
    // Validate credentials
    // Create access token
    // Create refresh token

    const tokenService = new TokenService(TOKEN_TYPE.ACCESS_TOKEN, {
        name: "Alejo", // Add the email, userId, role
    })

    const body = req.body;

    return res.status(200).send({
        ...body
    })
}


module.exports = {
    login
}
