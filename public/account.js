$("#waitIcon").hide()
let messages = []


$("#addLink").click((e) => {
	e.preventDefault()
	$("#linkField").attr("disabled", true)
	$("#addLink").attr("disabled", true)

	let url = $("#linkField").val()
	if(!url.trim()){
		_addAlertMessage("warning", "Please enter a link first")
		$("#linkField").attr("disabled", false)
		$("#addLink").attr("disabled", false)
		return
	}
	console.log(url)
	$("#waitIcon").show()
	$("#sendIcon").hide()
	fetch("/api/link/add", {
		method: 'POST',
		credentials: 'same-origin',
		headers: {
			"Content-Type": "application/json"
		},
		body: JSON.stringify({ link: url })
	}).then((response) => {
		return response.json()
	}).then((data) => {
		if(data.success){
			$("table").append($("<tr> <td><i class=\"fas fa-smile\" title=\"This link has just been added\"></i></td> <td><a href=" + url + " target=\"_blank\" style=\"text-decoration: none;\"><span style=\"color:#777;\">No title yet.</span></a></td> <td class=\"arLinks\"><i class=\"fas fa-trash-alt\" onclick=\"_delete(" + data.linkId + ")\" id=\"l" + data.linkId + "\"></i></td> </tr>"))
			_addAlertMessage("info", "This link has been added to your list, read it soon in your inbox!")
		}else{
			_addAlertMessage("warning", "This link seems unavailable. Please retry 🙏")
		}
		$("#linkField").attr("disabled", false)
		$("#addLink").attr("disabled", false)
		$("#waitIcon").hide()
		$("#sendIcon").show()
		$("#linkField").val("")
	})
	.catch((err) => {
		console.log(err)
		_addAlertMessage("warning", "Can't reach server. Please retry 🙏")
		$("#linkField").attr("disabled", false)
		$("#addLink").attr("disabled", false)
		$("#waitIcon").hide()
		$("#sendIcon").show()
	})

	// _addAlertMessage("info", "Added.")
	// _addAlertMessage("warning", "Ooops.")
	// _addAlertMessage("thanks", "Thanks for subscribing <3")
})

let _addAlertMessage = (type, text, duration = 10000) => {
	let sign = ""
	$("#alert").show()
	if(type == "info"){ sign = '<i class="fas fa-info-circle"></i>' }
	else if(type == "warning"){ sign = '<i class="fas fa-exclamation-triangle"></i>' }
	else if(type == "thanks"){ sign = '<i class="fas fa-heart"></i>' }
	messages.push("<div id='a" + messages.length + "'>" + sign + " " + text + "</div>")
	$("#alert").append(messages[messages.length - 1])
	setTimeout(() => { $("#alert div:first").remove(); messages.shift(); if(messages.length === 0){$("#alert").hide()} }, duration)
}

let _delete = (id) => {
	let r = confirm("Are you sure you want to delete this link?")
	if(r){
		// Delete
		fetch("/api/link/" + id, {
			method: "DELETE",
			credentials: 'same-origin',
			headers: {
				"Content-Type": "application/json"
			}
		}).then((res) => {return res.json()})
		  .then((data) => {
		  	if(data.success){
		  		_addAlertMessage("info", "This link has been deleted!")
		  		$("#l" + id).parent().parent().remove() // Remove link
		  	}else{
		  		_addAlertMessage("warning", "It seems like this link can't be deleted")
		  	}
		  })
	}
}